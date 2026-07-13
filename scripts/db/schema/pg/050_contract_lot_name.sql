-- 050_contract_lot_name.sql — recover the fuller per-lot description for a
-- contract from its tender.
--
-- Why: the АОП OCDS feed publishes contracts.title already truncated ("…, Обособена
-- позиция 1: Извършване … (КСК) ..."). The ЦАИС ЕОП tender carries a per-lot name
-- that runs considerably longer (though it too can be source-truncated). We store
-- that lot name in contracts.lot_name so the contract page can render the lot
-- description in full instead of the truncated tail welded into the title.
--
-- Join key is УНП, NOT ocid: the three contract feeds write disjoint ocid
-- namespaces and only the 2026 OCDS slice shares tenders.ocid (see 049). УНП is
-- stable across all feeds. The lot is matched by the "Обособена позиция N" number
-- parsed out of the (still reliable) title prefix against tenders.lots[].lotId.

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS lot_name text;

-- Full recompute of contracts.lot_name from the УНП-matched tender's lots[].
-- Idempotent — safe to re-run after any contracts or tenders reload. Returns the
-- number of contracts that ended up with a lot_name.
CREATE OR REPLACE FUNCTION enrich_contract_lot_names() RETURNS integer AS $$
DECLARE n integer;
BEGIN
  -- Compute (key, lot name) in a plain SELECT — a LATERAL may not reference the
  -- UPDATE target table, so the join lives in a CTE and the UPDATEs key off it.
  -- Both writes are guarded (IS DISTINCT FROM / NOT EXISTS) so a reload with
  -- unchanged data rewrites zero rows.
  WITH matched AS MATERIALIZED (
    SELECT c.key, lot.name
    FROM contracts c
    JOIN tenders t ON t.unp = c.unp
    CROSS JOIN LATERAL (
      SELECT elem->>'name' AS name
      FROM jsonb_array_elements(t.lots) elem
      WHERE elem->>'lotId' = substring(c.title from 'Обособена позиция\s+(\d+)')
      LIMIT 1
    ) lot
    WHERE c.unp IS NOT NULL
      AND c.title ~ 'Обособена позиция\s+\d+'
      AND jsonb_typeof(t.lots) = 'array'
      AND lot.name IS NOT NULL
      AND length(lot.name) > 0
  ),
  upd AS (
    UPDATE contracts c SET lot_name = m.name
    FROM matched m
    WHERE m.key = c.key AND c.lot_name IS DISTINCT FROM m.name
    RETURNING 1
  ),
  cleared AS (
    UPDATE contracts c SET lot_name = NULL
    WHERE c.lot_name IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.key = c.key)
    RETURNING 1
  )
  -- upd + cleared are data-modifying CTEs — Postgres always executes them even
  -- though the final projection only reads `matched`.
  SELECT count(*) INTO n FROM matched;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- contracts_list is `SELECT c.*` — a view freezes its column list at creation, so
-- it won't expose the new lot_name column until recreated. Rebuild it via the
-- shared rebuild_contracts_list() (000_search_fns.sql) — the single source of
-- truth 042 also calls, so the served column set can't drift by load order.
SELECT rebuild_contracts_list();
