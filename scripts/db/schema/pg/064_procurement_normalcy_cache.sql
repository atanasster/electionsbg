-- Precompute for "how normal is this procurement?" (migration 063). The live
-- procurement_normalcy() scans a whole CPV division with heap fetches for the
-- non-indexed metric columns — ~290ms warm but ~90MB of cold Cloud SQL buffer
-- reads (6-12s) per uncached contract, and the /api/db route is not CDN-cached,
-- so every first view paid it. This turns a view into a PK seek.
--
-- TWO changes vs 063:
--   1. The cohort is (adaptive CPV prefix × ERA), not a per-target ±30-month
--      window. Era buckets — pre-2015 / 2015-2019 / 2020+ — keep the comparison
--      era-matched (procurement value drifts with inflation across a 15-year
--      corpus) while being SET-BASED: every contract sharing a (prefix, era)
--      shares one cohort, so percentiles come from window functions in a few
--      passes instead of a per-row scan. The adaptive prefix floor (n>=30) is
--      evaluated WITHIN the era. Concentration stays all-time — a supplier's
--      share of a buyer's lifetime spend isn't an era question.
--   2. procurement_normalcy_cache — one precomputed payload per contract,
--      byte-for-byte the shape procurement_normalcy() returns, served by PK. The
--      route seeks the cache and falls back to the live function for a key not
--      yet built (freshly ingested between refreshes).
--
-- The live function is rewritten to the SAME (prefix, era) cohort so the cache
-- and the fallback are byte-identical (parity-checked).

-- Era bucket for a contract by its notice year. String compare on the YYYY head
-- (the date is 'YYYY-MM-DD' text) — no date parsing, so a blank/malformed date
-- degrades to NULL (its own tiny bucket) rather than raising.
CREATE OR REPLACE FUNCTION procurement_era(p_date text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_date IS NULL OR btrim(p_date) = '' THEN 'e0'  -- non-null so cohort joins are equi-joinable
    WHEN left(p_date, 4) < '2015' THEN 'e1'
    WHEN left(p_date, 4) < '2020' THEN 'e2'
    ELSE 'e3'
  END;
$$;

-- NOTE: procurement_normalcy(text) — the live/reference fn — lives ONLY in
-- 063_procurement_normalcy.sql. It USED to be duplicated here too, and since
-- load_pg applies 064 AFTER 063 this stale copy silently clobbered 063 on every
-- load. Removed. This file now owns just procurement_era + the cache TABLE.


-- --------------------------------------------------------------------------
-- Precomputed per-contract payload — the SET-BASED build of the same output.
-- rank()-1 over a cohort = the count strictly below (ties share the min rank),
-- exactly the live function's `count(value < x)`, so the percentiles match to the
-- same ROUND(…,4). Cohort partition key = (cpv-prefix, era). One row per signed
-- contract; served by PK.
-- --------------------------------------------------------------------------

-- The precomputed per-contract payloads live in a TABLE (not a materialized
-- view). The expensive cohort build (064b_procurement_normalcy_build.sql) runs
-- ONCE on the fast local Postgres; load_pg.ts then SHIPS the rows to Cloud SQL
-- via COPY (targetIsCloud branch) instead of REFRESHing ~40 min on the
-- shared-core prod instance. Deterministic function of `contracts` (rounded
-- percentiles), so local-computed == what cloud would compute.
DO $mv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'procurement_normalcy_cache') THEN
    DROP MATERIALIZED VIEW procurement_normalcy_cache CASCADE;
  END IF;
END $mv$;
CREATE TABLE IF NOT EXISTS procurement_normalcy_cache (
  key     text  PRIMARY KEY,
  payload jsonb NOT NULL
);
