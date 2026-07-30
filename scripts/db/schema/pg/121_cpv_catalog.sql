-- The named CPV-code catalogue, materialised.
--
-- WHY THIS EXISTS: /api/db/cpv-catalog served this list with a live
--   SELECT DISTINCT ON (cpv) cpv, cpv_desc FROM tenders
--    WHERE cpv IS NOT NULL AND cpv_desc IS NOT NULL AND btrim(cpv_desc) <> ''
--    ORDER BY cpv, length(cpv_desc) DESC
-- which is a full scan of `tenders` plus an external-merge sort, on EVERY mount
-- of the contracts browser and the tenders browser. MEASURED (2026-07-30):
-- 130 ms on the local Docker Postgres, but 17.7 s and 20.8 s on two consecutive
-- prod calls, one of which returned HTTP 500 — and useCpvCatalog swallowed the
-- failure (`if (!r.ok) return []`), so the searchable CPV filter came up silently
-- EMPTY rather than erroring.
--
-- The result is ~3.6k rows that change only when the tenders corpus is reloaded,
-- so it belongs in a table refreshed by that load — not recomputed per request.
--
-- A TABLE, not a matview, matching 112 and 067. A non-CONCURRENT REFRESH takes
-- exactly the AccessExclusive lock the DELETE+INSERT below avoids, and CONCURRENT
-- needs a unique index and still rewrites the whole thing — for 3.6k rows that is
-- all cost and no benefit.
--
-- ⚠️ Populated by scripts/db/load_tenders_pg.ts, which calls
-- rebuild_cpv_catalog() at the end of every tenders load. On the cloud side that
-- is `npm run db:load:tenders:pg:cloud` — the same command that already ships the
-- tenders corpus, so no new deploy step. A database that has this file applied
-- but has never run the loader serves an EMPTY catalogue, which is exactly the
-- failure the route used to have; cpv_catalog.data.test.ts fails on it.

CREATE TABLE IF NOT EXISTS cpv_catalog (
  cpv  text PRIMARY KEY,
  "desc" text NOT NULL
);
GRANT SELECT ON cpv_catalog TO app_readonly;

-- DELETE + INSERT inside one transaction, not TRUNCATE: TRUNCATE takes an
-- AccessExclusive lock that blocks the serving route, and this table is small
-- enough that the delete is free. Same reasoning as rebuild_contract_risk_cache
-- (112) at far smaller scale.
CREATE OR REPLACE FUNCTION rebuild_cpv_catalog() RETURNS bigint AS $fn$
DECLARE n bigint;
BEGIN
  IF to_regclass('public.tenders') IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM cpv_catalog;
  -- DISTINCT ON + "longest description wins" is carried over verbatim from the
  -- route it replaces: the same CPV code appears with several descriptions across
  -- the corpus, and the longest is the least truncated.
  INSERT INTO cpv_catalog (cpv, "desc")
  SELECT DISTINCT ON (cpv) cpv, cpv_desc
    FROM tenders
   WHERE cpv IS NOT NULL
     AND cpv_desc IS NOT NULL
     AND btrim(cpv_desc) <> ''
   -- cpv_desc as the final tiebreak: without it DISTINCT ON is non-deterministic
   -- for two descriptions of equal length, so the table and the gate's recomputed
   -- source query could disagree and report false staleness. 0 ties in the corpus
   -- today (measured), which is precisely why it would surface as a mystery later.
   ORDER BY cpv, length(cpv_desc) DESC, cpv_desc;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$ LANGUAGE plpgsql;
