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
-- ⚠️ A NULL founded_date means "the register answered and had no dated deed" —
-- it must NEVER mean "we failed to reach the register". The fetcher's resume
-- query skips every EIK already present, so a row written on a failed fetch is
-- a permanent, silent lie. The 2026-07 backfill learned this the hard way: as
-- the source throttled the crawler, the daily null rate climbed 4.7% → 47.2%
-- and ~4,100 reachable firms were recorded as undated. http_status/attempts
-- exist so that failure mode is auditable rather than invisible; the fetcher
-- now refuses to write a row it could not actually resolve.
-- http_status/attempts are the provenance that makes a NULL auditable: a row
-- with http_status IS NULL predates the fix and cannot be trusted, which is
-- what `--requeue-nulls` targets.
CREATE TABLE IF NOT EXISTS company_founded (
  eik          text PRIMARY KEY,
  founded_date date,
  source       text,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  http_status  int,
  attempts     int
);
-- Repeated below as ALTERs so re-applying 033 over a table created before the
-- columns existed is still a no-op (these files are idempotent full re-applies,
-- not a sequential migration chain).
ALTER TABLE company_founded ADD COLUMN IF NOT EXISTS http_status int;
ALTER TABLE company_founded ADD COLUMN IF NOT EXISTS attempts    int;
GRANT SELECT ON company_founded TO app_readonly;

-- EIK → declared NACE (НКИД/КИД-2008) division, for the nkidMismatch flag (§8 B1).
-- Same cross-loader ordering hazard as company_founded above: the matview below is
-- recreated WITH DATA on every apply, so procurement_risk_indexes() runs at apply
-- time and MUST find this table — but its authoritative definition + loader live in
-- migration 140 / db:load:cr-nkid:pg, which may not have run yet (cold DB, or 033
-- re-applied by load_pg before the NKID loader). So create an idempotent empty shell
-- here (columns identical to 140 — whichever CREATE IF NOT EXISTS runs first wins,
-- the other is a no-op). Empty by default → nkidByEik is '{}' → the flag is simply
-- unavailable everywhere, which is correct until a CR Deeds crawl populates it.
CREATE TABLE IF NOT EXISTS company_nkid (
  eik       text PRIMARY KEY,
  nace_code text,
  nace_div  text NOT NULL,
  label     text,
  source    text NOT NULL DEFAULT 'registryagency:CR/Deeds'
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON company_nkid TO app_readonly;
  END IF;
END $$;

-- The cache matview depends on the function — drop it first so the
-- DROP FUNCTION below doesn't fail on the dependency.
DROP MATERIALIZED VIEW IF EXISTS procurement_risk_indexes_cache;

-- NGO foreign-funding link — a NEUTRAL DISCLOSURE surfaced on the contract page,
-- NOT a corruption-risk flag (foreign funding is lawful; framing it as a red
-- flag is the exact "foreign-agent" trap the NGO feature avoids, see
-- docs/plans/ngo-competitive-research.md). One row per contractor EIK that is
-- either (a) itself an NGO with foreign funding, or (b) a firm whose declared
-- owner/officer sits on a foreign-funded NGO's board. The row carries the
-- headline NGO / funder / amount for the tooltip. This table is OWNED here (so
-- procurement_risk_indexes() can read it on a fresh load — the function must not
-- reference ngo_funding / ngo_board_links directly, which are created by later,
-- separately-run loaders). It stays EMPTY until rebuild_procurement_ngo_foreign_link()
-- (migration 080, run by the NGO loaders once ngo_funding + ngo_board_links
-- exist) populates it; those loaders then refresh procurement_risk_indexes_cache.
CREATE TABLE IF NOT EXISTS procurement_ngo_foreign_link (
  eik       text PRIMARY KEY,   -- the CONTRACTOR eik that carries the disclosure
  kind      text NOT NULL,      -- 'direct' (contractor IS the NGO) | 'connected' (owner on its board)
  ngo_name  text,               -- the foreign-funded NGO's name
  ngo_eik   text,               -- the NGO's eik (= eik when kind='direct')
  person    text,               -- the shared board member (kind='connected'); NULL for 'direct'
  funder    text,               -- headline funder (largest grant)
  eur       numeric             -- total foreign funding to the NGO
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared risk derivations, as VIEWS.
--
-- These were inline CTEs inside procurement_risk_indexes(). They are now views
-- because a SECOND consumer needs exactly the same numbers: the per-contract
-- risk cache (112) that backs the sortable/filterable risk column. Two
-- hand-maintained copies of "what counts as a concentrated pair" would drift,
-- and the drift would be invisible — the browser column and the contract page
-- would quietly disagree. One definition, two readers.
-- ─────────────────────────────────────────────────────────────────────────────

-- tag='contract' base (excludes amendments, which carry their own rows).
CREATE OR REPLACE VIEW risk_contract_base AS
  SELECT awarder_eik, awarder_name, contractor_eik, contractor_name,
         amount_eur, cpv, number_of_tenderers
  FROM contracts WHERE tag = 'contract';

-- Buyer→supplier pairs where the supplier holds >=30% of a >=EUR100k buyer's spend.
CREATE OR REPLACE VIEW risk_pair_concentration AS
  WITH awtot AS (
    SELECT awarder_eik, SUM(amount_eur) AS total
    FROM risk_contract_base GROUP BY awarder_eik
    HAVING SUM(amount_eur) >= 100000
  )
  -- COLLATE "C" pins MIN() to byte order: the local Docker and Cloud SQL
  -- glibc builds sort quotes/hyphens differently under the same en_US.utf8
  -- name, so an unpinned MIN picks different name variants per instance.
  SELECT c.awarder_eik, MIN(c.awarder_name COLLATE "C") AS awarder_name,
         c.contractor_eik, MIN(c.contractor_name COLLATE "C") AS contractor_name,
         SUM(c.amount_eur) AS pair_total, COUNT(*)::int AS n,
         awtot.total AS awarder_total
  FROM risk_contract_base c
  JOIN awtot ON awtot.awarder_eik = c.awarder_eik
  WHERE c.contractor_eik IS NOT NULL AND c.contractor_eik <> ''
  GROUP BY c.awarder_eik, c.contractor_eik, awtot.total
  HAVING SUM(c.amount_eur) / NULLIF(awtot.total, 0) >= 0.3;

CREATE OR REPLACE VIEW risk_cpv_division AS
  SELECT left(cpv, 2) AS division,
         COUNT(*)::int AS contract_count,
         (COUNT(*) FILTER (WHERE number_of_tenderers IS NOT NULL))::int AS with_bid_data,
         (COUNT(*) FILTER (WHERE number_of_tenderers = 1))::int AS single_bid
  FROM risk_contract_base
  WHERE cpv IS NOT NULL AND left(cpv, 2) ~ '^\d{2}$'
  GROUP BY left(cpv, 2);

-- Typical bidder count per 5-digit CPV prefix — the baseline the graded
-- weak-competition flag reads ("materially fewer bidders than THIS market's
-- norm"). Only competitive markets (median >= 3, >= 30 rows with a bid count)
-- can trigger it, so we emit only those — keeps the payload small and the flag
-- conservative. Validated against the single-bidding price premium: below-norm
-- multi-bidder awards land ~13pp closer to the buyer's estimate.
CREATE OR REPLACE VIEW risk_cpv_median AS
  SELECT left(cpv, 5) AS cpv5,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY number_of_tenderers) AS med,
         COUNT(*) AS n
  FROM risk_contract_base
  WHERE cpv IS NOT NULL AND number_of_tenderers IS NOT NULL
  GROUP BY left(cpv, 5)
  HAVING COUNT(*) >= 30
     AND percentile_cont(0.5) WITHIN GROUP (ORDER BY number_of_tenderers) >= 3;

-- Split-purchase PATTERN (threshold-hugging). A (buyer, supplier, 2-digit CPV,
-- calendar year) group where EVERY contract is a direct award (no competition),
-- EACH is at/under the ЗОП чл.20 ал.4 direct-award ceiling, and together they
-- sum OVER it — i.e. money that, aggregated, would have required a competitive
-- procedure was instead placed as >=2 sub-threshold direct awards.
-- ⚠️ FRAMING: this is a PATTERN CONSISTENT WITH splitting, NOT a proven breach —
-- чл.20 ал.4 permits repeated direct awards for genuinely separate recurring
-- needs; only чл.21 bars slicing ONE need, which the data cannot distinguish.
-- Ceilings are date+category dependent (EUR, ÷1.95583; ДВ 88/2023 raised them
-- 2024-01-01): works (CPV 45) 25 565 ≤2023 / 40 903 2024+; goods & services
-- 15 339 ≤2023 / 25 565 2024+. See scripts/procurement/tender_base_rates.sql
-- and docs/plans/procurement-risk-v2.md §7.4.
CREATE OR REPLACE VIEW risk_split_source AS
  SELECT key, awarder_eik, awarder_name, contractor_eik, contractor_name,
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
    AND date ~ '^\d{4}-\d\d-\d\d';

CREATE OR REPLACE VIEW risk_split_group AS
  SELECT awarder_eik, MIN(awarder_name COLLATE "C") AS awarder_name,
         contractor_eik, MIN(contractor_name COLLATE "C") AS contractor_name,
         cpv_div, yr,
         COUNT(*)::int AS n, SUM(amount_eur) AS total, MIN(ceiling) AS ceiling
  FROM risk_split_source
  GROUP BY awarder_eik, contractor_eik, cpv_div, yr
  HAVING COUNT(*) >= 2
     AND bool_and(is_direct)                 -- every award is direct (no competition)
     AND bool_and(amount_eur <= ceiling)     -- each individually sub-threshold
     AND SUM(amount_eur) > MIN(ceiling);     -- but together over the ceiling

GRANT SELECT ON risk_contract_base, risk_pair_concentration, risk_cpv_division,
                risk_cpv_median, risk_split_source, risk_split_group TO app_readonly;

DROP FUNCTION IF EXISTS procurement_risk_indexes();
CREATE OR REPLACE FUNCTION procurement_risk_indexes()
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH pairs   AS (SELECT * FROM risk_pair_concentration),
     cpvdiv  AS (SELECT * FROM risk_cpv_division),
     cpv5med AS (SELECT * FROM risk_cpv_median),
     splits  AS (SELECT * FROM risk_split_group)
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
  -- NGO foreign-funding disclosure (NEUTRAL, not scored — see the table comment
  -- above). Read from the OWNED link table so this function has no dependency on
  -- the NGO tables. One representative row per contractor eik.
  'ngoForeignFunded', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'eik', eik, 'kind', kind, 'ngoName', ngo_name, 'ngoEik', ngo_eik,
      'person', person, 'funder', funder,
      'eur', CASE WHEN eur IS NULL THEN NULL ELSE ROUND(eur) END
    ) ORDER BY eur DESC NULLS LAST, eik), '[]'::jsonb)
    FROM procurement_ngo_foreign_link
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
  -- EIK → incorporation date, for the newFirmWinner flag. Restricted to EIKs
  -- that actually appear as a contractor (the register at large is irrelevant
  -- here), but NOT bounded by founding year.
  --
  -- ⚠️ It used to carry `founded_date >= '2018-01-01'` to keep the map small.
  -- That silently broke parity with contract_risk_cache (112), which joins
  -- company_founded unbounded: 333,411 contracts were "checkable" server-side
  -- and "not checkable" in the browser, 48% of all newFirmWinner fires could not
  -- fire client-side at all, and the CRI disagreed on 30.2% of the corpus — a
  -- contract stored as cri=18 rendering as "2 of 10 checks". Availability is
  -- per-CONTRACTOR, so trimming the map by founding year changes the DENOMINATOR,
  -- not just the hits; the bound was never sound. Cost of dropping it: ~2.3k →
  -- ~15.8k entries, +426KB on a session-cached payload. The whole slice goes
  -- away once the browser stops scoring and renders the server masks instead.
  --
  -- ⚠️ The contractor test must NOT filter on tag. It carried `ct.tag='contract'`
  -- and that was the SAME bug in a second disguise: 112 joins company_founded for
  -- every contract row, amendments included, so a contractor appearing ONLY on
  -- `contractAmendment` rows was checkable server-side and unavailable in the
  -- browser — denominator drift again, not a missing hit. Caught by
  -- risk_parity.harness.ts the first time it was allowed to run. MEASURED
  -- (2026-07-29): 16,772 → 16,774 entries over 404,206 `contract` + 3,487
  -- `contractAmendment` rows — ~+50 bytes on a 421 kB payload, same index-only
  -- plan (~51 ms). Small today, and it grows with the amendment corpus. Any
  -- predicate narrower than "appears as a contractor at all" reintroduces it.
  'foundedByEik', (
    SELECT COALESCE(jsonb_object_agg(f.eik, f.founded_date::text), '{}'::jsonb)
    FROM company_founded f
    WHERE f.founded_date IS NOT NULL
      AND EXISTS (SELECT 1 FROM contracts ct
                  WHERE ct.contractor_eik = f.eik)
  ),
  -- EIK → declared NACE 2-digit division, for the nkidMismatch flag (plan §8 B1).
  -- The crosswalk itself (NACE→CPV allow-map + universals) is a committed CLIENT
  -- artifact (src/lib/naceCpv.ts) the scorer imports directly, so only this per-eik
  -- map is DB-derived. ⚠️ Same denominator discipline as foundedByEik above: the
  -- availability bit is per-CONTRACTOR, so this MUST include every contractor with a
  -- nace_div and NOTHING narrower (no tag filter, no sector filter) — 112 LEFT JOINs
  -- company_nkid for every contract row, so any narrower predicate here drifts the
  -- CRI denominator between browser and server. company_nkid may be empty (no crawl
  -- yet) → '{}' → the flag is simply unavailable everywhere, which is correct.
  'nkidByEik', (
    SELECT COALESCE(jsonb_object_agg(n.eik, n.nace_div), '{}'::jsonb)
    FROM company_nkid n
    WHERE EXISTS (SELECT 1 FROM contracts ct
                  WHERE ct.contractor_eik = n.eik)
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
