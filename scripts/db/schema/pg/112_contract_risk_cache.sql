-- Per-CONTRACT risk index, computed in Postgres.
--
-- WHY THIS EXISTS: the 12 contract risk checks were scored only in TypeScript
-- (src/data/procurement/computeProcurementRisk.ts), per page, in the browser.
-- That works for rendering chips but makes the risk column un-sortable and
-- un-filterable — you cannot ORDER BY a number the server does not have — so
-- unlike a BUYER (awarder_risk_grade, 041) an individual contract had no index
-- and no "riskiest" ranking. This materialises the same 12 checks server-side.
--
-- ⚠️ SQL IS THE SOURCE OF TRUTH, and the TS scorer is held to it by the parity
-- harness (scripts/procurement/risk_parity.harness.ts). That direction matters:
-- a second hand-maintained scorer WILL drift, and the drift is invisible — the
-- browser column and the contract page would quietly disagree about the same
-- contract. The derivations both sides read (concentration pairs, CPV medians,
-- split groups) are the shared views in 033, not re-derived here.
--
-- Two deliberate, documented divergences from the TS scorer, both because the
-- server always has an index the browser may still be loading:
--   • pepConnected  — TS marks it UNAVAILABLE while the payload is in flight;
--     here the table is always present, so it is always available.
--   • appealUpheld  — TS marks it unavailable when the appeal join was not
--     selected; contracts_list always carries it, so it is always available.
-- The harness feeds the TS side fully-loaded maps so these agree under test.
--
-- shortTenderPeriod is ALWAYS unavailable: tender_period_start_date /
-- tender_period_end_date are 0% populated corpus-wide (measured, 407,560 rows).
-- It is still emitted so the ledger can say "not checkable" rather than omit it.
--
-- Depends on: contracts (001), the shared risk views + company_founded (033),
-- is_direct_award + risk_grade_letter (041), debarred, company_politicians
-- (008), upheld_ocids (042, optional — guarded).

SET check_function_bodies = off;

-- Fold a contractor name for debarred matching — SQL mirror of
-- normalizeContractorName() in src/data/procurement/useDebarred.tsx, which in
-- turn mirrors scripts/procurement/debarred.ts. Strip decoration, strip the
-- legal-form suffix, collapse whitespace, lowercase. Both sides of the
-- comparison go through it, so a row carrying an extra quote or ЕООД matches.
CREATE OR REPLACE FUNCTION fold_contractor_name(p_raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(btrim(coalesce(p_raw, '')), '[„"“”''`’‘()]', '', 'g'),
             '\s*(ЕООД|ООД|ЕАД|АД|ЕТ|СД|КД|КДА|ДЗЗД|АДСИЦ|ООД-К|ЕООД-К)\.?\s*$', '', 'i'),
           '\s+', ' ', 'g')));
$$;

-- Contract-grain CRI → letter. SEPARATE from risk_grade_letter (041) on purpose:
-- that one bands a value-weighted 0..100 ENTITY exposure score, whereas this
-- bands a fired/available ratio whose denominator can be as small as 5, so one
-- fired check moves it 20 points. Keeping its own function means the contract
-- bands can be calibrated against the real distribution without moving every
-- buyer's grade. Until calibrated it delegates, so the two agree by default.
CREATE OR REPLACE FUNCTION contract_risk_grade_letter(p_cri numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT risk_grade_letter(p_cri);
$$;

CREATE TABLE IF NOT EXISTS contract_risk_cache (
  key        text PRIMARY KEY,
  fired      int  NOT NULL,
  available  int  NOT NULL,
  cri        int  NOT NULL,
  score      int  NOT NULL,
  grade      text,
  components jsonb NOT NULL
);
-- Sorting is the whole point of this table; the key tiebreak keeps paging
-- deterministic (the engine already falls back to `key`).
CREATE INDEX IF NOT EXISTS idx_contract_risk_cache_cri
  ON contract_risk_cache (cri DESC, key);
CREATE INDEX IF NOT EXISTS idx_contract_risk_cache_grade
  ON contract_risk_cache (grade);
GRANT SELECT ON contract_risk_cache TO app_readonly;

-- Rebuild via DELETE+INSERT inside one transaction rather than TRUNCATE+COPY or
-- a rename-swap. TRUNCATE would take an AccessExclusive lock on a table the
-- serving view reads (a contracts reload already causes 500s that way,
-- [[reference_contracts_reload_lock]]), and a rename-swap breaks any view bound
-- to the table's OID. DELETE+INSERT keeps readers on the old snapshot until
-- commit and never blocks them.
CREATE OR REPLACE FUNCTION rebuild_contract_risk_cache() RETURNS bigint AS $fn$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.contracts') IS NULL
     OR to_regprocedure('is_direct_award(text,text)') IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM contract_risk_cache;

  INSERT INTO contract_risk_cache (key, fired, available, cri, score, grade, components)
  WITH deb AS (
    SELECT DISTINCT fold_contractor_name(name) AS fname
    FROM debarred WHERE coalesce(name, '') <> ''
  ),
  mp AS (
    SELECT DISTINCT eik FROM company_politicians
    WHERE kind = 'mp' AND ref LIKE '/candidate/mp-%'
  ),
  pep AS (
    SELECT DISTINCT eik FROM company_politicians WHERE kind = 'official'
  ),
  div AS (
    SELECT division,
           single_bid::numeric / NULLIF(with_bid_data, 0) AS single_bid_share
    FROM risk_cpv_division
  ),
  base AS (
    SELECT c.key, c.tag, c.awarder_eik, c.contractor_eik, c.contractor_name,
           c.amount_eur, c.signing_amount_eur, c.cpv, c.number_of_tenderers,
           c.procurement_method, c.procurement_method_rationale,
           c.tender_period_start_date, c.tender_period_end_date,
           COALESCE(NULLIF(c.date_signed, ''), NULLIF(c.date, '')) AS award_date,
           substr(c.date, 1, 4) AS yr,
           left(c.cpv, 2) AS cpv_div,
           left(c.cpv, 5) AS cpv5,
           CASE WHEN to_regclass('public.upheld_ocids') IS NULL THEN false
                ELSE EXISTS (SELECT 1 FROM upheld_ocids uo WHERE uo.ocid = c.ocid)
           END AS appeal_upheld
    FROM contracts c
  ),
  f AS (
    SELECT b.key,
      -- 1 debarred — always checkable (absence is a meaningful "not listed").
      true AS a_debarred,
      EXISTS (SELECT 1 FROM deb WHERE deb.fname = fold_contractor_name(b.contractor_name)) AS f_debarred,
      -- 2 mpConnected
      true AS a_mp,
      EXISTS (SELECT 1 FROM mp WHERE mp.eik = b.contractor_eik) AS f_mp,
      -- 3 pepConnected — always available server-side (see header).
      true AS a_pep,
      EXISTS (SELECT 1 FROM pep WHERE pep.eik = b.contractor_eik) AS f_pep,
      -- 4 awarderConcentration
      true AS a_conc,
      EXISTS (SELECT 1 FROM risk_pair_concentration p
               WHERE p.awarder_eik = b.awarder_eik
                 AND p.contractor_eik = b.contractor_eik) AS f_conc,
      -- 5 amendment
      true AS a_amend,
      (b.tag = 'contractAmendment') AS f_amend,
      -- 6 annexGrowth — only where an annex actually moved the value, so
      -- un-amended contracts are not diluted into the denominator.
      (b.signing_amount_eur IS NOT NULL AND b.signing_amount_eur > 0
        AND b.amount_eur IS NOT NULL) AS a_annex,
      (b.signing_amount_eur IS NOT NULL AND b.signing_amount_eur > 0
        AND b.amount_eur IS NOT NULL
        AND (b.amount_eur - b.signing_amount_eur) / b.signing_amount_eur >= 0.5) AS f_annex,
      -- 7 newFirmWinner — 2629800000 ms = 30.4375 d, matching MS_PER_MONTH in
      -- the TS scorer so the month count is identical, not merely close.
      (cf.founded_date IS NOT NULL AND b.award_date ~ '^\d{4}-\d\d-\d\d'
        AND b.award_date::date >= cf.founded_date) AS a_newfirm,
      (cf.founded_date IS NOT NULL AND b.award_date ~ '^\d{4}-\d\d-\d\d'
        AND b.award_date::date >= cf.founded_date
        AND floor((b.award_date::date - cf.founded_date) * 86400000.0 / 2629800000.0) < 12) AS f_newfirm,
      -- 8 splitPurchase
      true AS a_split,
      EXISTS (SELECT 1 FROM risk_split_group s
               WHERE s.awarder_eik = b.awarder_eik
                 AND s.contractor_eik = b.contractor_eik
                 AND s.cpv_div = b.cpv_div AND s.yr = b.yr) AS f_split,
      -- 9 appealUpheld — always available server-side (see header).
      true AS a_appeal,
      b.appeal_upheld AS f_appeal,
      -- 10 weakCompetition
      (b.number_of_tenderers IS NOT NULL) AS a_weak,
      (b.number_of_tenderers IS NOT NULL AND (
         -- single-bid, unless the division is structurally single-bid or the
         -- CPV is a statutory sole-source (22112 textbooks, чл.79 ал.1 т.3).
         (b.number_of_tenderers = 1
            AND NOT COALESCE(d.single_bid_share >= 0.8, false)
            AND COALESCE(b.cpv, '') NOT LIKE '22112%')
         -- …or materially fewer bidders than this market's norm.
         OR (m.med IS NOT NULL AND b.number_of_tenderers > 1
             AND b.number_of_tenderers < m.med
             AND NOT COALESCE(d.single_bid_share >= 0.8, false))
      )) AS f_weak,
      -- 11 directAward
      (COALESCE(b.procurement_method, '') <> ''
        OR COALESCE(b.procurement_method_rationale, '') <> '') AS a_direct,
      ((COALESCE(b.procurement_method, '') <> ''
         OR COALESCE(b.procurement_method_rationale, '') <> '')
       AND is_direct_award(b.procurement_method, b.procurement_method_rationale)) AS f_direct,
      -- 12 shortTenderPeriod — 0% populated corpus-wide; kept so the ledger can
      -- say "not checkable" instead of silently dropping a check.
      (b.tender_period_start_date IS NOT NULL AND b.tender_period_end_date IS NOT NULL
        AND b.tender_period_start_date ~ '^\d{4}-\d\d-\d\d'
        AND b.tender_period_end_date ~ '^\d{4}-\d\d-\d\d'
        AND b.tender_period_end_date::date >= b.tender_period_start_date::date) AS a_short,
      (b.tender_period_start_date IS NOT NULL AND b.tender_period_end_date IS NOT NULL
        AND b.tender_period_start_date ~ '^\d{4}-\d\d-\d\d'
        AND b.tender_period_end_date ~ '^\d{4}-\d\d-\d\d'
        AND b.tender_period_end_date::date >= b.tender_period_start_date::date
        AND (b.tender_period_end_date::date - b.tender_period_start_date::date) < 14) AS f_short
    FROM base b
    LEFT JOIN company_founded cf ON cf.eik = b.contractor_eik
    LEFT JOIN div d              ON d.division = b.cpv_div
    LEFT JOIN risk_cpv_median m  ON m.cpv5 = b.cpv5
  ),
  agg AS (
    SELECT f.*,
      (f.a_debarred::int + f.a_mp::int + f.a_pep::int + f.a_conc::int + f.a_amend::int
       + f.a_annex::int + f.a_newfirm::int + f.a_split::int + f.a_appeal::int
       + f.a_weak::int + f.a_direct::int + f.a_short::int) AS available,
      (f.f_debarred::int + f.f_mp::int + f.f_pep::int + f.f_conc::int + f.f_amend::int
       + f.f_annex::int + f.f_newfirm::int + f.f_split::int + f.f_appeal::int
       + f.f_weak::int + f.f_direct::int + f.f_short::int) AS fired,
      -- Legacy additive weights, capped at 100 — mirrors scoreFromFlags().
      LEAST(100,
        f.f_mp::int * 50 + f.f_pep::int * 40 + f.f_debarred::int * 80
        + f.f_weak::int * 40 + f.f_conc::int * 30 + f.f_direct::int * 20
        + f.f_short::int * 15 + f.f_amend::int * 10 + f.f_annex::int * 30
        + f.f_newfirm::int * 30 + f.f_split::int * 25 + f.f_appeal::int * 70
      ) AS score
    FROM f
  )
  SELECT a.key, a.fired, a.available,
         CASE WHEN a.available = 0 THEN 0
              ELSE round(100.0 * a.fired / a.available)::int END AS cri,
         a.score,
         contract_risk_grade_letter(
           CASE WHEN a.available = 0 THEN 0
                ELSE round(100.0 * a.fired / a.available) END) AS grade,
         jsonb_build_object(
           'debarred',             jsonb_build_object('a', a.a_debarred, 'f', a.f_debarred),
           'mpConnected',          jsonb_build_object('a', a.a_mp,       'f', a.f_mp),
           'pepConnected',         jsonb_build_object('a', a.a_pep,      'f', a.f_pep),
           'awarderConcentration', jsonb_build_object('a', a.a_conc,     'f', a.f_conc),
           'amendment',            jsonb_build_object('a', a.a_amend,    'f', a.f_amend),
           'annexGrowth',          jsonb_build_object('a', a.a_annex,    'f', a.f_annex),
           'newFirmWinner',        jsonb_build_object('a', a.a_newfirm,  'f', a.f_newfirm),
           'splitPurchase',        jsonb_build_object('a', a.a_split,    'f', a.f_split),
           'appealUpheld',         jsonb_build_object('a', a.a_appeal,   'f', a.f_appeal),
           'weakCompetition',      jsonb_build_object('a', a.a_weak,     'f', a.f_weak),
           'directAward',          jsonb_build_object('a', a.a_direct,   'f', a.f_direct),
           'shortTenderPeriod',    jsonb_build_object('a', a.a_short,    'f', a.f_short)
         )
  FROM agg a;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$ LANGUAGE plpgsql;
