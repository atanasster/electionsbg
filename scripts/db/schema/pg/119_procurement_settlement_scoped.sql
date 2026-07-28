-- 119_procurement_settlement_scoped.sql — the per-scope precomputes behind
-- /procurement/by-settlement.
--
-- WHY. The page used to fetch ONE blob carrying all ~868 settlements (196 KB) and
-- re-aggregate it in the browser for three choropleths, then paginate it 50 rows at a time.
-- Worse, only the FULL-CORPUS scope was cached (procurement_by_settlement_cache, 030): the
-- default scope is the selected parliament, so the common case ran the ~390 ms live
-- aggregate on every cache miss.
--
-- Both problems are the same problem — nothing was precomputed per SCOPE. These two
-- matviews are, keyed by procurement_scopes.scope_key (118), so the table paginates an
-- indexed relation and the maps read ≤32 rows.
--
--   procurement_settlement_rank   one row per (scope, settlement) — the ranking table
--   procurement_geo_payloads      one row per scope — the maps + the KPI/national header
--
-- NEITHER RE-IMPLEMENTS THE AGGREGATION. Both unnest procurement_by_settlement(from, to),
-- the function 030 already defines and the offline generator was verified byte-identical
-- against. So a change to the methodology (which buyers count as local-tier, how the
-- national card is split) lands in ONE place and both precomputes follow. The cost is
-- ~30 scopes × ~390 ms ≈ 12 s per refresh, paid once per load rather than per request.
--
-- REFRESHED CONCURRENTLY (both carry the required UNIQUE index): this table is on the
-- serving path, and a plain REFRESH takes an AccessExclusiveLock that would stall the page
-- for the whole recompute — the same lock hazard the contracts reload was bitten by.

SET check_function_bodies = off;

-- ── The ranking: one row per settlement per scope ────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS procurement_settlement_rank;
-- WITH NO DATA: this file is applied inside one implicit transaction, so a populating
-- CREATE would hold an AccessExclusiveLock for the whole ~6 s build AND then be recomputed
-- by the loader's REFRESH straight after — paying twice, half of it under exactly the lock
-- CONCURRENTLY exists to avoid. The loader populates it; nothing reads it until then.
CREATE MATERIALIZED VIEW procurement_settlement_rank AS
SELECT
  s.scope_key,
  (e->>'ekatte')                   AS ekatte,
  (e->>'name')                     AS name,
  -- English name comes from the place dimension (117), NOT from the payload: it is the
  -- reason the browser no longer downloads the 940 KB settlements master to localise a
  -- table. COALESCE so a settlement the dimension somehow lacks still renders its
  -- Bulgarian name rather than a blank cell.
  COALESCE(pd.name_en, e->>'name') AS name_en,
  (e->>'province')                 AS province,
  (e->>'obshtina')                 AS obshtina,
  (e->>'totalEur')::numeric        AS total_eur,
  (e->>'contractCount')::int       AS contract_count,
  (e->>'awarderCount')::int        AS awarder_count,
  -- Search fold: ONE column covering the settlement, its obshtina and its oblast in both
  -- scripts, so the server-side search matches what the client used to do in memory —
  -- including shliokavica (Latin input against Cyrillic names). translit_bg_latin is the
  -- same fold the query is folded with at search time, which is what makes the gin_trgm
  -- index below usable instead of a full scan.
  translit_bg_latin(
    concat_ws(' ', e->>'name', COALESCE(pd.name_en, ''), e->>'obshtina', e->>'province')
  ) AS name_fold
FROM procurement_scopes s
CROSS JOIN LATERAL jsonb_array_elements(
  procurement_by_settlement(s.date_from, s.date_to) -> 'settlements'
) AS e
LEFT JOIN place_dim pd
  ON pd.kind = 'settlement' AND pd.code = (e->>'ekatte')
WITH NO DATA;

-- REQUIRED for REFRESH … CONCURRENTLY, and the natural key besides.
CREATE UNIQUE INDEX IF NOT EXISTS idx_psr_scope_ekatte
  ON procurement_settlement_rank (scope_key, ekatte);
-- The default sort. total_eur DESC then ekatte — the tiebreak is not cosmetic: without it
-- equal-valued rows can swap between pages mid-scroll, and the payload sorts already round
-- before ordering for exactly this reason (per-instance summation noise).
CREATE INDEX IF NOT EXISTS idx_psr_scope_total
  ON procurement_settlement_rank (scope_key, total_eur DESC, ekatte);
CREATE INDEX IF NOT EXISTS idx_psr_scope_contracts
  ON procurement_settlement_rank (scope_key, contract_count DESC, ekatte);
CREATE INDEX IF NOT EXISTS idx_psr_fold
  ON procurement_settlement_rank USING gin (name_fold gin_trgm_ops);

GRANT SELECT ON procurement_settlement_rank TO app_readonly;

-- ── The map + header payload: one row per scope ──────────────────────────────────────────
-- Everything the page needs that is NOT the table: the four KPI tiles, the "national
-- procurement" card (central buyers, deliberately not pinned to their Sofia HQ), and the
-- per-oblast aggregate the three choropleths colour.
--
-- Aggregated to PROVINCE NAME, not to an oblast code: the client already folds province →
-- canonical oblast (provinceToCanon / featureToCanon, with the Sofia and Plovdiv special
-- cases) and joins population for the per-capita metric. Folding here instead would have to
-- reproduce those cases in SQL — and would drop Sofia, whose settlement is absent from the
-- EKATTE master. ≤32 rows either way, so there is nothing to gain by moving it.
DROP MATERIALIZED VIEW IF EXISTS procurement_geo_payloads;
-- WITH NO DATA for the same reason as the ranking above.
CREATE MATERIALIZED VIEW procurement_geo_payloads AS
-- AS MATERIALIZED is load-bearing, not stylistic. procurement_by_settlement is STABLE, so
-- PG12+ inlines an unmarked CTE and pulls the subquery up — the planner then re-evaluates
-- the ~390 ms call once per `scoped.r` reference (five of them), turning a 6 s build into
-- 29 s. Measured; output is byte-identical either way.
WITH scoped AS MATERIALIZED (
  SELECT s.scope_key,
         procurement_by_settlement(s.date_from, s.date_to) AS r
  FROM procurement_scopes s
)
SELECT
  scoped.scope_key,
  jsonb_build_object(
    'summary', jsonb_build_object(
      'totalContracts',   scoped.r->'totalContracts',
      'totalEur',         scoped.r->'totalEur',
      'settlementCount',  scoped.r->'settlementCount',
      'national',         scoped.r->'national'
    ),
    'oblasti', COALESCE((
      SELECT jsonb_agg(o ORDER BY o->>'province')
      FROM (
        SELECT jsonb_build_object(
                 'province',      e->>'province',
                 'totalEur',      ROUND(SUM((e->>'totalEur')::numeric)),
                 'contractCount', SUM((e->>'contractCount')::int),
                 'awarderCount',  SUM((e->>'awarderCount')::int)
               ) AS o
        FROM jsonb_array_elements(scoped.r->'settlements') AS e
        GROUP BY e->>'province'
      ) agg
    ), '[]'::jsonb)
  ) AS payload
FROM scoped
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pgp_scope
  ON procurement_geo_payloads (scope_key);

GRANT SELECT ON procurement_geo_payloads TO app_readonly;
