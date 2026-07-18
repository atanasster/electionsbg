-- Consolidated risk-scorer indexes — ONE payload for the client-side
-- computeProcurementRisk inputs that used to be four separate static JSON
-- fetches (debarred.json, derived/awarder_concentration.json,
-- derived/mp_connected.json presence-set, derived/pep-by-eik manifest,
-- derived/cpv_competition.json). Corpus-scoped (lifetime), matching the
-- offline builders' semantics:
--   concentration: pair share ≥ 30% of the awarder's lifetime spend AND the
--                  awarder's lifetime spend ≥ €100k (derived.ts thresholds).
--   cpvCompetition: single-bid share per 2-digit CPV division over rows with
--                  bid data; structural bar 0.8 (cpv_competition.ts).
--   debarred: raw register rows — the client folds names with its own
--                  normalizeContractorName (the fold must match the client's).
-- Depends on contracts (001), debarred (014), company_politicians (008).
-- EXECUTE → app_readonly.

SET check_function_bodies = off;

-- Company incorporation dates, EIK → first-entry date, from the Registry Agency
-- CR API (portal.registryagency.bg/CR/api/Deeds/{eik}, min fieldEntryDate).
-- Populated by scripts/procurement/fetch_company_founded.ts (a bounded ~28k-EIK
-- backfill over the contractor set). Feeds the newFirmWinner flag: a contractor
-- that won a contract shortly after being incorporated. Created here (empty by
-- default → the flag is simply unavailable) so procurement_risk_indexes() can
-- reference it without a cross-loader ordering hazard.
-- ⚠️ Dates == 2008 are the ТР re-registration date (the register launched
-- 2008-01-01), NOT true founding — harmless here: such firms are old and never
-- fire a "new firm" check.
CREATE TABLE IF NOT EXISTS company_founded (
  eik          text PRIMARY KEY,
  founded_date date,
  source       text,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON company_founded TO app_readonly;

-- The cache matview depends on the function — drop it first so the
-- DROP FUNCTION below doesn't fail on the dependency.
DROP MATERIALIZED VIEW IF EXISTS procurement_risk_indexes_cache;

DROP FUNCTION IF EXISTS procurement_risk_indexes();
CREATE OR REPLACE FUNCTION procurement_risk_indexes()
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH c AS (
  SELECT awarder_eik, awarder_name, contractor_eik, contractor_name,
         amount_eur, cpv, number_of_tenderers
  FROM contracts WHERE tag = 'contract'
),
awtot AS (
  SELECT awarder_eik, SUM(amount_eur) AS total
  FROM c GROUP BY awarder_eik
  HAVING SUM(amount_eur) >= 100000
),
pairs AS (
  -- COLLATE "C" pins MIN() to byte order: the local Docker and Cloud SQL
  -- glibc builds sort quotes/hyphens differently under the same en_US.utf8
  -- name, so an unpinned MIN picks different name variants per instance.
  SELECT c.awarder_eik, MIN(c.awarder_name COLLATE "C") AS awarder_name,
         c.contractor_eik, MIN(c.contractor_name COLLATE "C") AS contractor_name,
         SUM(c.amount_eur) AS pair_total, COUNT(*)::int AS n,
         awtot.total AS awarder_total
  FROM c
  JOIN awtot ON awtot.awarder_eik = c.awarder_eik
  WHERE c.contractor_eik IS NOT NULL AND c.contractor_eik <> ''
  GROUP BY c.awarder_eik, c.contractor_eik, awtot.total
  HAVING SUM(c.amount_eur) / NULLIF(awtot.total, 0) >= 0.3
),
cpvdiv AS (
  SELECT left(cpv, 2) AS division,
         COUNT(*)::int AS contract_count,
         (COUNT(*) FILTER (WHERE number_of_tenderers IS NOT NULL))::int AS with_bid_data,
         (COUNT(*) FILTER (WHERE number_of_tenderers = 1))::int AS single_bid
  FROM c
  WHERE cpv IS NOT NULL AND left(cpv, 2) ~ '^\d{2}$'
  GROUP BY left(cpv, 2)
),
-- Typical bidder count per 5-digit CPV prefix — the baseline the graded
-- weak-competition flag reads ("materially fewer bidders than THIS market's
-- norm"). Only competitive markets (median >= 3, >= 30 rows with a bid count)
-- can trigger it, so we emit only those — keeps the payload small and the flag
-- conservative. Validated against the single-bidding price premium: below-norm
-- multi-bidder awards land ~13pp closer to the buyer's estimate.
cpv5med AS (
  SELECT left(cpv, 5) AS cpv5,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY number_of_tenderers) AS med,
         COUNT(*) AS n
  FROM c
  WHERE cpv IS NOT NULL AND number_of_tenderers IS NOT NULL
  GROUP BY left(cpv, 5)
  HAVING COUNT(*) >= 30
     AND percentile_cont(0.5) WITHIN GROUP (ORDER BY number_of_tenderers) >= 3
),
-- Split-purchase PATTERN (threshold-hugging). A (buyer, supplier, 2-digit CPV,
-- calendar year) group where EVERY contract is a direct award (no competition),
-- EACH is at/under the ЗОП чл.20 ал.4 direct-award ceiling, and together they
-- sum OVER it — i.e. money that, aggregated, would have required a competitive
-- procedure was instead placed as ≥2 sub-threshold direct awards.
-- ⚠️ FRAMING: this is a PATTERN CONSISTENT WITH splitting, NOT a proven breach —
-- чл.20 ал.4 permits repeated direct awards for genuinely separate recurring
-- needs; only чл.21 bars slicing ONE need, which the data cannot distinguish.
-- Ceilings are date+category dependent (EUR, ÷1.95583; ДВ 88/2023 raised them
-- 2024-01-01): works (CPV 45) 25 565 ≤2023 / 40 903 2024+; goods & services
-- 15 339 ≤2023 / 25 565 2024+. See scripts/procurement/tender_base_rates.sql
-- and docs/plans/procurement-risk-v2.md §7.4.
split_src AS (
  SELECT awarder_eik, awarder_name, contractor_eik, contractor_name,
         left(cpv, 2) AS cpv_div,
         substr(date, 1, 4) AS yr,
         amount_eur,
         is_direct_award(procurement_method, procurement_method_rationale) AS is_direct,
         CASE
           WHEN left(cpv, 2) = '45' AND date < '2024-01-01' THEN 25565
           WHEN left(cpv, 2) = '45'                         THEN 40903
           WHEN date < '2024-01-01'                        THEN 15339
           ELSE 25565
         END AS ceiling
  FROM contracts
  WHERE tag = 'contract'
    AND contractor_eik IS NOT NULL AND contractor_eik <> ''
    AND awarder_eik IS NOT NULL AND amount_eur > 0
    AND cpv IS NOT NULL AND left(cpv, 2) ~ '^\d{2}$'
    AND date ~ '^\d{4}-\d\d-\d\d'
),
splits AS (
  SELECT awarder_eik, MIN(awarder_name COLLATE "C") AS awarder_name,
         contractor_eik, MIN(contractor_name COLLATE "C") AS contractor_name,
         cpv_div, yr,
         COUNT(*)::int AS n, SUM(amount_eur) AS total, MIN(ceiling) AS ceiling
  FROM split_src
  GROUP BY awarder_eik, contractor_eik, cpv_div, yr
  HAVING COUNT(*) >= 2
     AND bool_and(is_direct)                 -- every award is direct (no competition)
     AND bool_and(amount_eur <= ceiling)     -- each individually sub-threshold
     AND SUM(amount_eur) > MIN(ceiling)      -- but together over the ceiling
)
SELECT jsonb_build_object(
  'debarred', jsonb_build_object(
    'entries', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', d.name,
        'publishedAt', d.published_at,
        'debarredUntil', d.debarred_until,
        'detailsUrl', d.details_url
      ) ORDER BY d.published_at DESC NULLS LAST), '[]'::jsonb)
      FROM debarred d WHERE COALESCE(d.name, '') <> ''
    )
  ),
  'concentration', jsonb_build_object(
    'thresholdPct', 0.3,
    'minAwarderTotalEur', 100000,
    'entries', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'awarderEik', p.awarder_eik,
        'awarderName', p.awarder_name,
        'contractorEik', p.contractor_eik,
        'contractorName', p.contractor_name,
        'sharePct', ROUND((p.pair_total / NULLIF(p.awarder_total, 0))::numeric, 4),
        'awarderTotalEur', ROUND(p.awarder_total),
        'pairTotalEur', ROUND(p.pair_total),
        'contractCount', p.n
      -- Sort by the ROUNDED total + eik tiebreaks → deterministic order
      -- across instances (raw float sums carry per-instance summation-order
      -- noise, so near-equal values would otherwise swap and break
      -- payload-equality checks)
      ) ORDER BY ROUND(p.pair_total) DESC, p.awarder_eik, p.contractor_eik), '[]'::jsonb)
      FROM pairs p
    )
  ),
  'mpConnected', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'eik', eik, 'mpId', mp_id, 'mpName', mp_name
    ) ORDER BY eik, mp_id), '[]'::jsonb)
    FROM (
      SELECT DISTINCT eik,
             NULLIF(regexp_replace(ref, '^/candidate/mp-', ''), '')::int AS mp_id,
             politician AS mp_name
      FROM company_politicians
      WHERE kind = 'mp' AND ref LIKE '/candidate/mp-%'
    ) m
  ),
  'pepConnectedEiks', (
    SELECT COALESCE(jsonb_agg(DISTINCT eik), '[]'::jsonb)
    FROM company_politicians WHERE kind = 'official'
  ),
  'cpvCompetition', jsonb_build_object(
    'structuralSingleBidShare', 0.8,
    'divisions', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'division', division,
        'contractCount', contract_count,
        'withBidData', with_bid_data,
        'singleBid', single_bid,
        'singleBidShare',
          CASE WHEN with_bid_data = 0 THEN 0
               ELSE ROUND((single_bid::numeric / with_bid_data), 4) END
      ) ORDER BY division), '[]'::jsonb)
      FROM cpvdiv
    )
  ),
  -- 5-digit CPV prefix → median bidder count, for competitive markets only
  -- (median >= 3). The graded arm of the weak-competition flag reads this:
  -- a multi-bidder award below its market's norm. Keyed by 5-digit prefix.
  'cpvBidderMedians', (
    SELECT COALESCE(jsonb_object_agg(cpv5, med), '{}'::jsonb) FROM cpv5med
  ),
  -- EIK → incorporation date, for the newFirmWinner flag. Bounded to firms
  -- founded 2018+ (a 2020–2026 contract can only be "shortly after founding" for
  -- a firm younger than that) and to EIKs that actually appear as a contractor,
  -- so the map stays small (a few thousand, not the whole register).
  'foundedByEik', (
    SELECT COALESCE(jsonb_object_agg(f.eik, f.founded_date::text), '{}'::jsonb)
    FROM company_founded f
    WHERE f.founded_date >= '2018-01-01'
      AND EXISTS (SELECT 1 FROM contracts ct
                  WHERE ct.tag='contract' AND ct.contractor_eik = f.eik)
  ),
  -- Split-purchase pair-years — keyed by buyer|supplier|cpvDiv|year in the
  -- scorer. "For review", not proof (see the split_src comment above).
  'splitPurchase', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'awarderEik', awarder_eik, 'awarderName', awarder_name,
      'contractorEik', contractor_eik, 'contractorName', contractor_name,
      'cpvDiv', cpv_div, 'year', yr,
      'contractCount', n, 'totalEur', ROUND(total), 'ceilingEur', ceiling
    ) ORDER BY ROUND(total) DESC, awarder_eik, contractor_eik, cpv_div, yr), '[]'::jsonb)
    FROM splits
  )
);
$$;

-- MEASURED (2026-07-03): the live function is a full-corpus aggregate —
-- ~700ms local / ~2.8s warm on Cloud SQL (db-g1-small), over the repo's
-- 200ms precompute bar for a payload every contract-row page needs. The
-- route serves this matview instead; load_pg refreshes it after each load
-- (the ingest cadence — the payload is deterministic per corpus).
CREATE MATERIALIZED VIEW IF NOT EXISTS procurement_risk_indexes_cache AS
  SELECT procurement_risk_indexes() AS r;
