-- Per-CONTRACT risk index, computed in Postgres.
--
-- WHY THIS EXISTS: the 13 contract risk checks were scored only in TypeScript
-- (src/data/procurement/computeProcurementRisk.ts), per page, in the browser.
-- That works for rendering chips but makes the risk column un-sortable and
-- un-filterable — you cannot ORDER BY a number the server does not have — so
-- unlike a BUYER (awarder_risk_grade, 041) an individual contract had no index
-- and no "riskiest" ranking. This materialises the same 13 checks server-side.
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
-- Depends on: contracts (001), the shared risk views + company_founded +
-- company_nkid (033 shells both), is_direct_award + risk_grade_letter (041),
-- debarred, company_politicians (008), upheld_ocids (042, optional — guarded),
-- and the NACE→CPV crosswalk tables (140; shelled below so this file is
-- self-sufficient when 140 / db:load:cr-nkid:pg has not run — e.g. a fresh clone,
-- where the empty tables make nkidMismatch simply unavailable).

SET check_function_bodies = off;

-- NACE→CPV crosswalk shells. Their authoritative definition + data live in
-- migration 140 / db:load:cr-nkid:pg (a REFRESH_EXCLUSIONS loader, so NOT applied
-- by db:refresh). rebuild_contract_risk_cache() references all three, and a plpgsql
-- function is parse-analysed as a whole — so they MUST exist when this file is
-- applied, even on a database that never ran the NKID loader. Columns are identical
-- to 140 (CREATE IF NOT EXISTS — whichever runs first wins, the other is a no-op).
-- company_nkid itself is shelled by 033 (a db:refresh migration), like company_founded.
CREATE TABLE IF NOT EXISTS nace_cpv_allow (
  nace_div text NOT NULL,
  cpv_div  text NOT NULL,
  PRIMARY KEY (nace_div, cpv_div)
);
CREATE TABLE IF NOT EXISTS nace_cpv_opinion (
  nace_div text PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS nace_cpv_universal (
  cpv_div text PRIMARY KEY
);

-- The grade used to take the CRI; drop that overload so nothing binds to a
-- stale signature after this file is re-applied over an older database.
DROP FUNCTION IF EXISTS contract_risk_grade_letter(numeric);

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

-- Contract-grain grade. SEPARATE from risk_grade_letter (041) and banded on the
-- FIRED COUNT, not on the CRI ratio. Both choices are forced by the measured
-- distribution over all 407,560 contracts (2026-07-27):
--
--   fired  0: 258,706 (63.5%)   3: 2,938 (0.72%)
--          1: 122,334 (30.0%)   4:   403 (0.10%)
--          2:  23,098 ( 5.7%)   5:    70 (0.02%)   6: 11 (0.003%)
--
-- The CRI is not a continuous score — it is a 23-value lattice, because
-- `fired` only ever reaches 6 and `available` only varies 7..11. Feeding it to
-- 041's bands (A<10 … F>=70) put 99% of the corpus in A/B and made **F
-- mathematically unreachable**: the corpus maximum CRI is 60, so the eleven
-- most-flagged contracts in the country would read "E". A grade nobody can
-- score is not a grade.
--
-- Banding on the fired count instead gives every letter a real population and a
-- one-sentence meaning ("F = five or more checks fired"), which is also what
-- the UI has to explain anyway. The CRI stays as the sortable continuous key.
--
-- ⚠️ Known wrinkle, deliberately not hidden: because the CRI divides by a
-- varying denominator it is *almost* monotone in `fired`, but not quite — a
-- 4-of-11 contract scores 36 while a 3-of-8 scores 38. So a handful of rows
-- sort just below a lower grade. The grade itself is unaffected (it reads
-- `fired` directly), and the leaderboard orders by fired first for this reason.
CREATE OR REPLACE FUNCTION contract_risk_grade_letter(p_fired int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_fired IS NULL THEN NULL
    WHEN p_fired <= 0 THEN 'A'
    WHEN p_fired = 1 THEN 'B'
    WHEN p_fired = 2 THEN 'C'
    WHEN p_fired = 3 THEN 'D'
    WHEN p_fired = 4 THEN 'E'
    ELSE 'F'
  END;
$$;

-- Bit positions for available_mask / fired_mask. This ORDER IS A CONTRACT with
-- every reader (the serving view, the SPA ledger, the parity harness) — append
-- new checks at the end, never renumber, or historic masks silently re-map.
--   0 debarred          4 amendment       8  appealUpheld     12 nkidMismatch
--   1 mpConnected       5 annexGrowth     9  weakCompetition
--   2 pepConnected      6 newFirmWinner   10 directAward
--   3 awarderConcentration 7 splitPurchase 11 shortTenderPeriod
--
-- Masks rather than a per-row jsonb object: the jsonb form measured 284 MB for
-- 407k rows — ~700 bytes to carry 24 bits — which is a real cost on a
-- db-g1-small. Two ints carry the same information in 8 bytes.
CREATE TABLE IF NOT EXISTS contract_risk_cache (
  key            text PRIMARY KEY,
  fired          int  NOT NULL,
  available      int  NOT NULL,
  cri            int  NOT NULL,
  score          int  NOT NULL,
  grade          text,
  available_mask int  NOT NULL,
  fired_mask     int  NOT NULL
);
-- Migrating from the jsonb shape: drop the old column if an earlier apply made it.
ALTER TABLE contract_risk_cache DROP COLUMN IF EXISTS components;
ALTER TABLE contract_risk_cache ADD COLUMN IF NOT EXISTS available_mask int NOT NULL DEFAULT 0;
ALTER TABLE contract_risk_cache ADD COLUMN IF NOT EXISTS fired_mask     int NOT NULL DEFAULT 0;

-- Decode a mask to the check names, so SQL consumers and ad-hoc queries do not
-- each hard-code the bit order above.
CREATE OR REPLACE FUNCTION contract_risk_checks(p_mask int)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(name ORDER BY bit), '{}'::text[])
  FROM unnest(ARRAY['debarred','mpConnected','pepConnected','awarderConcentration',
                    'amendment','annexGrowth','newFirmWinner','splitPurchase',
                    'appealUpheld','weakCompetition','directAward','shortTenderPeriod',
                    'nkidMismatch'])
       WITH ORDINALITY AS t(name, ord)
  CROSS JOIN LATERAL (SELECT (ord - 1)::int AS bit) b
  WHERE (p_mask >> b.bit) & 1 = 1;
$$;
-- Sorting is the whole point of this table; the key tiebreak keeps paging
-- deterministic (the engine already falls back to `key`).
CREATE INDEX IF NOT EXISTS idx_contract_risk_cache_cri
  ON contract_risk_cache (cri DESC, key);
CREATE INDEX IF NOT EXISTS idx_contract_risk_cache_grade
  ON contract_risk_cache (grade);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON contract_risk_cache TO app_readonly;
  END IF;
END $$;

-- PROVENANCE OF THE SERVED MASKS. One row, describing the last rebuild.
--
-- WHY IT EXISTS: the flag definitions are a published, versioned artifact
-- (src/lib/riskFlagCatalog.ts, docs/plans/procurement-risk-open-source-v1.md), and
-- the methodology page invites a journalist to cite "flag set vX.Y.Z". The version
-- in the BUNDLE says what the code declares; every flag a reader actually sees came
-- out of contract_risk_cache, built by the last rebuild. Those two diverge for the
-- entire window between a deploy and a cache rebuild — which on the cloud side is
-- an explicit, easily-skipped operator step (a ~90-minute contracts reload, or
-- apply_functions.ts followed by SELECT rebuild_contract_risk_cache()). Citing the
-- bundle's version over masks computed under an older one is the one claim we would
-- have no way to walk back, so the page reads THIS.
--
-- ⚠️ A NULL catalog_version means "not stamped", and that is deliberately the
-- result of a rebuild run WITHOUT a version (the no-arg overload below, i.e. a hand
-- run via psql). Leaving the previous stamp in place would be worse than having
-- none: it would assert that masks were computed under a version they were not.
-- Absence is honest; a stale stamp is a false claim.
CREATE TABLE IF NOT EXISTS contract_risk_meta (
  only_row        boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  catalog_version text,
  rebuilt_at      timestamptz NOT NULL DEFAULT now(),
  row_count       bigint
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON contract_risk_meta TO app_readonly;
  END IF;
END $$;

-- The ONE writer of contract_risk_meta. Both rebuild overloads call it.
--
-- Extracted rather than inlined twice for two reasons. It keeps the "a blank or
-- absent version stores NULL, never ''" rule in one place — an empty string would
-- render as a version-shaped nothing on the methodology page instead of taking
-- its "not stamped" branch. And it makes the stamping TESTABLE on its own: a
-- rebuild of the 409k-row cache is ~36 s locally, so a gate that exercised the
-- stamp through six rebuilds would cost four minutes to assert an upsert.
CREATE OR REPLACE FUNCTION contract_risk_stamp(p_version text, p_rows bigint)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO contract_risk_meta (only_row, catalog_version, rebuilt_at, row_count)
  VALUES (true, nullif(btrim(p_version), ''), clock_timestamp(), p_rows)
  ON CONFLICT (only_row) DO UPDATE
    SET catalog_version = EXCLUDED.catalog_version,
        rebuilt_at      = EXCLUDED.rebuilt_at,
        row_count       = EXCLUDED.row_count;
$$;

-- Rebuild via DELETE+INSERT inside one transaction rather than TRUNCATE+COPY or
-- a rename-swap. TRUNCATE would take an AccessExclusive lock on a table the
-- serving view reads (a contracts reload already causes 500s that way,
-- [[reference_contracts_reload_lock]]), and a rename-swap breaks any view bound
-- to the table's OID. DELETE+INSERT keeps readers on the old snapshot until
-- commit and never blocks them.
CREATE OR REPLACE FUNCTION rebuild_contract_risk_cache() RETURNS bigint AS $fn$
DECLARE n bigint;
BEGIN
  -- Every relation this function names must EXIST, even on the branch that
  -- "guards" it: a statement is parse-analysed as a whole, so a runtime
  -- CASE/IF around a missing relation still raises "relation does not exist".
  -- upheld_ocids is created by 042 (a LATER loader than the one applying this
  -- file), so it is reached through a view that is re-pointed at reality here,
  -- at rebuild time, rather than referenced directly.
  -- ⚠️ SECOND READER: scripts/procurement/risk_parity.harness.ts resolves
  -- appealUpheld from `upheld_ocids` DIRECTLY and deliberately does NOT come
  -- through this view — 042's DROP MATERIALIZED VIEW … CASCADE removes it and
  -- silently disarmed the parity gate for months. Renaming the matview, or making
  -- the empty stub below non-empty, must be mirrored there or the comparison
  -- quietly changes meaning.
  IF to_regclass('public.upheld_ocids') IS NOT NULL THEN
    EXECUTE 'CREATE OR REPLACE VIEW risk_upheld_ocid AS SELECT ocid FROM upheld_ocids';
  ELSE
    EXECUTE 'CREATE OR REPLACE VIEW risk_upheld_ocid AS SELECT NULL::text AS ocid WHERE false';
  END IF;
  -- Role-guarded like every other GRANT in this file, but the failure it prevents is a
  -- DIFFERENT one, because this runs at function-CALL time rather than at apply time:
  -- load_pg.ts calls rebuild_contract_risk_cache() at the end of the same run, so on a
  -- cluster without the role a bare GRANT here aborts the contracts load AFTER the corpus
  -- has been copied, not before.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    EXECUTE 'GRANT SELECT ON risk_upheld_ocid TO app_readonly';
  END IF;

  -- Bail politely only when the whole corpus is absent; the remaining
  -- dependencies (debarred, company_politicians, company_founded, the 033 views,
  -- is_direct_award) all ship in migrations applied before this one, so a
  -- missing one is a broken install that should surface, not be swallowed.
  IF to_regclass('public.contracts') IS NULL
     OR to_regprocedure('is_direct_award(text,text)') IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM contract_risk_cache;

  INSERT INTO contract_risk_cache
    (key, fired, available, cri, score, grade, available_mask, fired_mask)
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
           EXISTS (SELECT 1 FROM risk_upheld_ocid uo WHERE uo.ocid = c.ocid) AS appeal_upheld
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
        AND (b.tender_period_end_date::date - b.tender_period_start_date::date) < 14) AS f_short,
      -- 13 nkidMismatch — the contract's CPV division is disjoint from the
      -- contractor's declared НКИД division. Mirrors naceCpvMismatch() (the SSOT,
      -- src/lib/naceCpv.ts): AVAILABLE iff the contractor has a declared NACE the
      -- crosswalk has an OPINION on (nace_div ∈ nace_cpv_opinion) AND the contract
      -- carries a CPV division; FIRED iff, additionally, that CPV is neither
      -- universal (nace_cpv_universal) nor in the NACE's allow-set (nace_cpv_allow).
      -- A missing NACE, missing CPV, or an unmapped NACE ⇒ unavailable, so a data
      -- gap can never manufacture a flag. Availability is per-CONTRACTOR — no tag or
      -- sector predicate — matching 033's nkidByEik denominator (the same discipline
      -- that foundedByEik got wrong once; see the parity harness header).
      (nk.nace_div IS NOT NULL
        AND EXISTS (SELECT 1 FROM nace_cpv_opinion o WHERE o.nace_div = nk.nace_div)
        AND COALESCE(b.cpv_div, '') <> '') AS a_nkid,
      (nk.nace_div IS NOT NULL
        AND EXISTS (SELECT 1 FROM nace_cpv_opinion o WHERE o.nace_div = nk.nace_div)
        AND COALESCE(b.cpv_div, '') <> ''
        AND NOT EXISTS (SELECT 1 FROM nace_cpv_universal u WHERE u.cpv_div = b.cpv_div)
        AND NOT EXISTS (SELECT 1 FROM nace_cpv_allow al
                         WHERE al.nace_div = nk.nace_div AND al.cpv_div = b.cpv_div)) AS f_nkid
    FROM base b
    LEFT JOIN company_founded cf ON cf.eik = b.contractor_eik
    LEFT JOIN company_nkid     nk ON nk.eik = b.contractor_eik
    LEFT JOIN div d              ON d.division = b.cpv_div
    LEFT JOIN risk_cpv_median m  ON m.cpv5 = b.cpv5
  ),
  agg AS (
    SELECT f.*,
      (f.a_debarred::int + f.a_mp::int + f.a_pep::int + f.a_conc::int + f.a_amend::int
       + f.a_annex::int + f.a_newfirm::int + f.a_split::int + f.a_appeal::int
       + f.a_weak::int + f.a_direct::int + f.a_short::int + f.a_nkid::int) AS available,
      (f.f_debarred::int + f.f_mp::int + f.f_pep::int + f.f_conc::int + f.f_amend::int
       + f.f_annex::int + f.f_newfirm::int + f.f_split::int + f.f_appeal::int
       + f.f_weak::int + f.f_direct::int + f.f_short::int + f.f_nkid::int) AS fired,
      -- Legacy additive weights, capped at 100 — mirrors scoreFromFlags().
      LEAST(100,
        f.f_mp::int * 50 + f.f_pep::int * 40 + f.f_debarred::int * 80
        + f.f_weak::int * 40 + f.f_conc::int * 30 + f.f_direct::int * 20
        + f.f_short::int * 15 + f.f_amend::int * 10 + f.f_annex::int * 30
        + f.f_newfirm::int * 30 + f.f_split::int * 25 + f.f_appeal::int * 70
        + f.f_nkid::int * 20
      ) AS score
    FROM f
  )
  SELECT a.key, a.fired, a.available,
         CASE WHEN a.available = 0 THEN 0
              ELSE round(100.0 * a.fired / a.available)::int END AS cri,
         a.score,
         contract_risk_grade_letter(a.fired) AS grade,
         -- Bit order per the contract documented on the table above.
         (a.a_debarred::int << 0) | (a.a_mp::int      << 1) | (a.a_pep::int    << 2)
       | (a.a_conc::int     << 3) | (a.a_amend::int   << 4) | (a.a_annex::int  << 5)
       | (a.a_newfirm::int  << 6) | (a.a_split::int   << 7) | (a.a_appeal::int << 8)
       | (a.a_weak::int     << 9) | (a.a_direct::int  << 10)| (a.a_short::int  << 11)
       | (a.a_nkid::int     << 12),
         (a.f_debarred::int << 0) | (a.f_mp::int      << 1) | (a.f_pep::int    << 2)
       | (a.f_conc::int     << 3) | (a.f_amend::int   << 4) | (a.f_annex::int  << 5)
       | (a.f_newfirm::int  << 6) | (a.f_split::int   << 7) | (a.f_appeal::int << 8)
       | (a.f_weak::int     << 9) | (a.f_direct::int  << 10)| (a.f_short::int  << 11)
       | (a.f_nkid::int     << 12)
  FROM agg a;

  GET DIAGNOSTICS n = ROW_COUNT;

  -- Stamp the rebuild, CLEARING any catalogue version. This overload does not
  -- know which flag set it just applied, so it must not leave the previous claim
  -- standing (see contract_risk_meta's header). The one-argument overload below
  -- is what records a version.
  PERFORM contract_risk_stamp(NULL, n);

  RETURN n;
END;
$fn$ LANGUAGE plpgsql;

-- Stamped rebuild. Callers that know the catalogue version they are building
-- under pass it; scripts/db/lib/rebuildRiskCache.ts is the single TS entry point
-- so the version comes from one place (CATALOG_VERSION) rather than three.
--
-- An OVERLOAD rather than a DEFAULT parameter: adding a defaulted argument to the
-- existing function would leave both a 0-arg and a 1-arg-with-default candidate,
-- and `SELECT rebuild_contract_risk_cache()` would then fail as ambiguous — on a
-- call site inside load_pg.ts, i.e. mid-contracts-reload. Two arities can never be
-- ambiguous.
CREATE OR REPLACE FUNCTION rebuild_contract_risk_cache(p_catalog_version text)
RETURNS bigint AS $fn$
DECLARE n bigint; before timestamptz;
BEGIN
  SELECT rebuilt_at INTO before FROM contract_risk_meta WHERE only_row;
  n := rebuild_contract_risk_cache();

  -- Only claim a version when the rebuild ACTUALLY RAN.
  --
  -- The no-arg overload bails out (RETURN 0) on a database with no `contracts`
  -- corpus or no is_direct_award(), WITHOUT touching the cache or the stamp.
  -- Stamping a version after that would assert that the masks currently in
  -- contract_risk_cache were produced by this catalogue version, when this call
  -- rebuilt nothing at all — precisely the false provenance claim the whole table
  -- exists to prevent, and the worst possible one because it looks healthiest.
  --
  -- "Did it run" is read off the stamp the inner call leaves: clock_timestamp()
  -- advances even within one transaction, so an unchanged rebuilt_at means the
  -- bail-out branch was taken.
  IF EXISTS (
    SELECT 1 FROM contract_risk_meta
     WHERE only_row AND (before IS NULL OR rebuilt_at > before)
  ) THEN
    PERFORM contract_risk_stamp(p_catalog_version, n);
  END IF;

  RETURN n;
END;
$fn$ LANGUAGE plpgsql;

-- contracts_list is a `SELECT c.*` view whose column list freezes at creation,
-- so it must be rebuilt now that the risk cache exists — otherwise the columns
-- are invisible to the table engine no matter how they are declared in the
-- registry. Migrations 042 and 050 rebuild it for the same reason.
SELECT rebuild_contracts_list();
