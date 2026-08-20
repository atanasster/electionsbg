-- 122_contractor_rank.sql — the per-scope contractor leaderboard behind
-- /procurement/contractors ("Топ изпълнители").
--
-- WHY. The page used to ship the top-1,000 contractors from the full-corpus
-- procurement_rankings_cache (031, since RETIRED by 124) into a client DataTable — no ?pscope scope, no
-- filters, and ~28,500 of the ~29,500 contractors unreachable. This matview is the
-- server-side, scope-keyed leaderboard behind a DbDataTable browser instead: one
-- row per (scope, contractor, CPV-division), paginated over an indexed relation.
--
-- Mirrors 119 (procurement_settlement_rank): keyed by procurement_scopes.scope_key
-- (118), fanned out FROM procurement_scopes CROSS JOIN LATERAL a windowed function
-- so `all`/`ns:`/`y:` are just rows with different date bounds, and the aggregation
-- methodology lives in ONE place (contractor_ranks_windowed) rather than being
-- re-implemented in the matview.
--
-- CPV IS A ROLLUP DIMENSION, NOT AN ARRAY. The DbDataTable engine has no Postgres
-- array support (filter:"in" is scalar `col IN (...)`), so "top contractors in
-- construction" cannot be an array-overlap filter. Instead each contractor gets a
-- per-division row PLUS an `'ALL'` rollup row (GROUPING SETS); the browser filters
-- division = <2-digit> (default 'ALL'). The 'ALL' row totals every contract —
-- including those with null/malformed CPV — so it is the true total, never the sum
-- of the division rows.
--
--   contractor_rank         one row per (scope, contractor, division|'ALL')
--   contractor_scope_kpis   one row per scope — the 3 headline KPIs
--
-- Depends on contracts (001), company_politicians (008), tr_companies, and
-- procurement_scopes (118). Both matviews created WITH NO DATA and REFRESHed
-- CONCURRENTLY by load_procurement_scopes_pg (each carries the required UNIQUE
-- index); contractor_scope_kpis reads contractor_rank, so it is refreshed AFTER it.
--
-- COST (measured, local): REFRESH contractor_rank ≈ 9 s (30 scopes × the windowed
-- GROUPING-SETS aggregate over contracts, the `all`/current-`ns:` scopes scanning the
-- whole corpus), contractor_scope_kpis ≈ 0.1 s. In the same ballpark as 119's ~12 s;
-- paid once per load, not per request.

SET check_function_bodies = off;

-- ── The windowed aggregation (methodology in one place) ──────────────────────────────────
-- Reuses the 031 base→ctr→others→mpties shape, but grouped by CPV division via
-- GROUPING SETS and returning ROWS (not a JSON blob), and with NO per-scope LIMIT —
-- the whole point of the redesign is exposing every contractor, paged server-side.
DROP MATERIALIZED VIEW IF EXISTS contractor_scope_kpis;
DROP MATERIALIZED VIEW IF EXISTS contractor_rank;
DROP FUNCTION IF EXISTS contractor_ranks_windowed(text, text);
CREATE OR REPLACE FUNCTION contractor_ranks_windowed(
  p_from text DEFAULT NULL,
  p_to text DEFAULT NULL
)
RETURNS TABLE(
  eik text,
  division text,
  name text,
  total_eur double precision,   -- double, NOT numeric: node-postgres serializes
                                --  numeric as a STRING → blank money cells on the SPA
  contract_count int,
  award_count int,
  total_other jsonb,
  is_mp_tied boolean
) LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT tag, contractor_eik, contractor_name, amount, currency, amount_eur,
         -- Division = the 2-digit CPV head, guarded to real numeric codes; NULL for
         -- null/malformed CPV (those rows still count toward the 'ALL' rollup).
         CASE WHEN cpv ~ '^[0-9]{2}' THEN left(cpv, 2) END AS div
  FROM contracts
  WHERE date >= COALESCE(p_from, '')
    AND date <  COALESCE(p_to, '9999-99-99')
    AND tag IN ('contract', 'award')
    AND contractor_eik IS NOT NULL AND contractor_eik <> ''
),
agg AS (
  SELECT contractor_eik AS eik,
         GROUPING(div) AS is_all,
         CASE WHEN GROUPING(div) = 1 THEN 'ALL' ELSE div END AS division,
         MIN(contractor_name) AS name,
         -- ROUND on the emitted value AND the sort key + eik tiebreak so paging is
         -- stable across scan plans / instances (031 determinism rule).
         ROUND(COALESCE(SUM(amount_eur) FILTER (WHERE tag = 'contract'), 0))::double precision AS total_eur,
         (COUNT(*) FILTER (WHERE tag = 'contract'))::int AS contract_count,
         (COUNT(*) FILTER (WHERE tag = 'award'))::int    AS award_count
  FROM base
  GROUP BY GROUPING SETS ((contractor_eik, div), (contractor_eik))
  HAVING COUNT(*) FILTER (WHERE tag = 'contract') > 0
),
-- Native remainder per contractor (rows whose currency never got EUR-converted):
-- a handful corpus-wide, aggregated once and shown on the 'ALL' leaderboard row.
-- Same shape as 031's `others`; division rows show €-only.
others AS (
  SELECT contractor_eik AS eik, jsonb_object_agg(cur, s) AS other FROM (
    SELECT contractor_eik, currency AS cur, ROUND(SUM(amount)) AS s
    FROM base
    WHERE tag = 'contract' AND amount_eur IS NULL
      AND amount IS NOT NULL AND currency IS NOT NULL
    GROUP BY contractor_eik, currency
  ) q GROUP BY contractor_eik
),
mp AS (
  SELECT DISTINCT cp.eik
  FROM company_politicians cp
  WHERE cp.kind = 'mp' AND cp.ref LIKE '/candidate/mp-%'
)
SELECT
  a.eik,
  a.division,
  -- Canonical TR name when present, same override as 031.
  COALESCE((SELECT tc.name FROM tr_companies tc WHERE tc.uic = a.eik), a.name) AS name,
  a.total_eur,
  a.contract_count,
  a.award_count,
  COALESCE(CASE WHEN a.is_all = 1 THEN o.other END, '{}'::jsonb) AS total_other,
  (mp.eik IS NOT NULL) AS is_mp_tied
FROM agg a
LEFT JOIN others o ON o.eik = a.eik
LEFT JOIN mp ON mp.eik = a.eik
-- Keep every 'ALL' rollup row; among per-division rows drop the malformed-CPV
-- (div IS NULL) group — those contracts survive only inside the 'ALL' total.
WHERE a.is_all = 1 OR a.division IS NOT NULL;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION contractor_ranks_windowed(text, text) TO app_readonly;
  END IF;
END $$;

-- ── The ranking: one row per (scope, contractor, division|'ALL') ──────────────────────────
-- WITH NO DATA for the same lock reason as 119: the loader populates it via REFRESH
-- CONCURRENTLY straight after; nothing reads it until then.
CREATE MATERIALIZED VIEW contractor_rank AS
SELECT
  s.scope_key,
  -- eik is the paging tiebreak (the registry's select[0], appended by the engine to
  -- every ORDER BY). It is unique within the always-filtered (scope_key, division)
  -- partition, so it is a total order there — and every composite sort index below
  -- trails with eik, so the default sort stays index-served under any sort column.
  -- Same role ekatte plays for 119; no synthetic surrogate needed.
  r.eik,
  r.division,
  r.name,
  -- Search fold: the same translit_bg_latin the query is folded with at search time,
  -- which is what makes the gin_trgm index usable (shliokavica / Latin-against-Cyrillic).
  translit_bg_latin(r.name) AS name_fold,
  r.total_eur,
  r.contract_count,
  r.award_count,
  r.total_other,
  r.is_mp_tied
FROM procurement_scopes s
CROSS JOIN LATERAL contractor_ranks_windowed(s.date_from, s.date_to) AS r
WITH NO DATA;

-- REQUIRED for REFRESH … CONCURRENTLY, and the natural key besides.
CREATE UNIQUE INDEX IF NOT EXISTS idx_contractor_rank_key
  ON contractor_rank (scope_key, division, eik);
-- The default sort. Every browser query filters (scope_key, division), so the sort
-- indexes lead with both; the eik tiebreak stops equal-valued rows swapping pages.
--
-- ⚠️ `DESC NULLS LAST` IS LOAD-BEARING AND MUST MATCH buildOrder EXACTLY. db_table.js
-- emits `<col> DESC NULLS LAST` for every descending sort, while a plain `DESC` index is
-- NULLS FIRST — and Postgres will NOT bridge the two, so a mismatched index is simply not
-- a candidate and the arrival degrades to a scan plus a top-N heapsort. MEASURED on the
-- default `/procurement/contractors` arrival (scope_key='all', division='ALL', 29,622
-- rows): 665 buffers / 5.3 ms against 28 buffers / 0.016 ms.
--
-- The `eik` tail matches buildOrder's ASC tiebreak; flipping it to DESC would cost the
-- index the tiebreak and leave an Incremental Sort on top.
--
-- ⚠️ Note the NOT NULL escape hatch does NOT exist — the rule holds for ordinary tables
-- with NOT NULL columns too. Postgres compares pathkeys structurally and never consults
-- a NOT NULL constraint to equate two NULLS orderings. Verified on a NOT NULL int column:
-- a `(v DESC, id)` index serves `ORDER BY v DESC` and is refused for
-- `ORDER BY v DESC NULLS LAST`. `price_products.chain_count` is the corpus example.
--
-- The house-wide gate is scripts/db/tests/db_table_sort_indexes.data.test.ts.
CREATE INDEX IF NOT EXISTS idx_contractor_rank_total
  ON contractor_rank (scope_key, division, total_eur DESC NULLS LAST, eik);
CREATE INDEX IF NOT EXISTS idx_contractor_rank_contracts
  ON contractor_rank (scope_key, division, contract_count DESC NULLS LAST, eik);
CREATE INDEX IF NOT EXISTS idx_contractor_rank_fold
  ON contractor_rank USING gin (name_fold gin_trgm_ops);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON contractor_rank TO app_readonly;
  END IF;
END $$;

-- ── The KPI blob: one row per scope ──────────────────────────────────────────────────────
-- The 3 headline KPIs a per-row table can't compute. Built FROM contractor_rank
-- (WHERE division='ALL', so the rollup rows are counted once) — NOT from a re-called
-- function, which sidesteps the 119 AS-MATERIALIZED inlining trap but makes this
-- matview DEPEND on contractor_rank, so it must be refreshed after it.
CREATE MATERIALIZED VIEW contractor_scope_kpis AS
WITH ranked AS (
  SELECT scope_key, eik, total_eur, is_mp_tied,
         row_number() OVER (PARTITION BY scope_key ORDER BY total_eur DESC, eik) AS rn
  FROM contractor_rank
  WHERE division = 'ALL'
)
SELECT
  scope_key,
  COUNT(*)::int AS contractor_count,
  ROUND(SUM(total_eur))::double precision AS total_eur,
  -- Market concentration: value taken by the top 10 contractors.
  CASE WHEN SUM(total_eur) > 0
       THEN COALESCE(SUM(total_eur) FILTER (WHERE rn <= 10), 0) / SUM(total_eur)
       ELSE 0 END AS top10_share,
  -- Value flowing to MP-tied companies (scarce, high-impact).
  COALESCE(SUM(total_eur) FILTER (WHERE is_mp_tied), 0)::double precision AS mp_tied_eur,
  CASE WHEN SUM(total_eur) > 0
       THEN COALESCE(SUM(total_eur) FILTER (WHERE is_mp_tied), 0) / SUM(total_eur)
       ELSE 0 END AS mp_tied_share,
  (COUNT(*) FILTER (WHERE is_mp_tied))::int AS mp_tied_count
FROM ranked
GROUP BY scope_key
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contractor_scope_kpis_scope
  ON contractor_scope_kpis (scope_key);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON contractor_scope_kpis TO app_readonly;
  END IF;
END $$;
