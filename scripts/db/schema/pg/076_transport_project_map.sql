-- 076_transport_project_map.sql — the physical transport infrastructure the money builds,
-- for the /sector/transport (Транспорт) map. Draws what the contract TITLES name, the way
-- the НЗОК map draws hospitals and the judiciary map draws courts.
--
-- The state-transport ENTITIES are all Sofia-registered, so an awarder-seat map is
-- degenerate (София + Варна only). The meaningful geography is the INFRASTRUCTURE named in
-- the titles, of which there are two shapes:
--   • a rail SECTION between two towns — "Костенец–Септември", "Пловдив–Бургас", "Горна
--     Оряховица–Шумен" — drawn as a LINE between the two centroids;
--   • a single-site facility — a station, port or junction ("гара Каспичан", "Пристанище
--     Бургас", "Видин") — drawn as a POINT, typed rail / port / station.
-- Both are geocoded offline by scripts/db/load_transport_project_map_pg.ts against
-- data/settlements.json. A contract naming no town (train operations, rolling stock, fuel,
-- fleet-wide insurance — network-wide, ~70% of value) has no single location and is absent.
--
-- transport_project_link holds one row per (contract, link): kind='segment' carries both
-- endpoints, kind='point' carries only the a_* endpoint (b_town = ''). transport_project_map()
-- folds the windowed contracts corpus onto those links (spend + count + single-bid share),
-- aggregating segments by the unordered town pair and points by town, so the map fetches ONE
-- scope-aware blob. Renders off the LIVE contracts corpus — no new ingest. Depends on
-- contracts (001). SELECT/EXECUTE → app_readonly.

SET check_function_bodies = off;

-- Replace the earlier point-only transport_project_site (all uncommitted; clean swap).
DROP TABLE IF EXISTS transport_project_site;

CREATE TABLE IF NOT EXISTS transport_project_link (
  key      text NOT NULL,          -- contracts.key (PK there)
  kind     text NOT NULL,          -- 'segment' | 'point'
  facility text,                   -- point only: 'rail' | 'port' | 'station' | 'junction'
  a_town   text NOT NULL,
  a_lng    double precision,
  a_lat    double precision,
  b_town   text NOT NULL DEFAULT '', -- segment only; '' for a point (keeps the PK non-null)
  b_lng    double precision,
  b_lat    double precision,
  PRIMARY KEY (key, a_town, b_town)
);
CREATE INDEX IF NOT EXISTS idx_transport_project_link_key ON transport_project_link (key);
GRANT SELECT ON transport_project_link TO app_readonly;

-- Windowed [from, to) with sargable COALESCE bounds (matches scopeByWindow's half-open,
-- string-compared guard so the awarder_eik index is kept), tag='contract' only. Returns two
-- collections: line segments (rail sections) and points (stations/ports/junctions), each
-- ranked by spend DESC with a name tiebreak for byte-deterministic ordering.
DROP FUNCTION IF EXISTS transport_project_map(text[], text, text);
CREATE OR REPLACE FUNCTION transport_project_map(
  p_eiks text[],
  p_from text DEFAULT NULL,
  p_to   text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT key, number_of_tenderers, amount_eur
  FROM contracts
  WHERE awarder_eik = ANY(p_eiks) AND tag = 'contract'
    AND date >= COALESCE(p_from, '')
    AND date <  COALESCE(p_to, '99999999')
),
-- Segments: fold by the UNORDERED town pair (least/greatest) so "A–B" and "B–A" merge.
seg AS (
  SELECT LEAST(l.a_town, l.b_town)    AS t1,
         GREATEST(l.a_town, l.b_town) AS t2,
         -- endpoints keyed to the ordered names so the polyline is stable
         MIN(CASE WHEN l.a_town = LEAST(l.a_town, l.b_town) THEN l.a_lng ELSE l.b_lng END) AS lng1,
         MIN(CASE WHEN l.a_town = LEAST(l.a_town, l.b_town) THEN l.a_lat ELSE l.b_lat END) AS lat1,
         MIN(CASE WHEN l.a_town = LEAST(l.a_town, l.b_town) THEN l.b_lng ELSE l.a_lng END) AS lng2,
         MIN(CASE WHEN l.a_town = LEAST(l.a_town, l.b_town) THEN l.b_lat ELSE l.a_lat END) AS lat2,
         (COUNT(*))::int                                                 AS contract_count,
         ROUND(COALESCE(SUM(b.amount_eur), 0))::double precision         AS total_eur,
         (COUNT(*) FILTER (WHERE b.number_of_tenderers IS NOT NULL))::int AS bid_known_n,
         (COUNT(*) FILTER (WHERE b.number_of_tenderers = 1))::int         AS single_bid_n
  FROM base b
  JOIN transport_project_link l ON l.key = b.key AND l.kind = 'segment'
  WHERE l.a_lng IS NOT NULL AND l.a_lat IS NOT NULL
    AND l.b_lng IS NOT NULL AND l.b_lat IS NOT NULL
  GROUP BY 1, 2
),
-- Points: fold by town, keeping the dominant facility type (most-frequent, name tiebreak).
pt AS (
  SELECT l.a_town AS town, l.a_lng AS lng, l.a_lat AS lat,
         (COUNT(*))::int                                                 AS contract_count,
         ROUND(COALESCE(SUM(b.amount_eur), 0))::double precision         AS total_eur,
         (COUNT(*) FILTER (WHERE b.number_of_tenderers IS NOT NULL))::int AS bid_known_n,
         (COUNT(*) FILTER (WHERE b.number_of_tenderers = 1))::int         AS single_bid_n,
         (mode() WITHIN GROUP (ORDER BY l.facility))                      AS facility
  FROM base b
  JOIN transport_project_link l ON l.key = b.key AND l.kind = 'point'
  WHERE l.a_lng IS NOT NULL AND l.a_lat IS NOT NULL
  GROUP BY l.a_town, l.a_lng, l.a_lat
)
SELECT jsonb_build_object(
  'segments', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'a',             jsonb_build_array(lng1, lat1),
      'b',             jsonb_build_array(lng2, lat2),
      'aTown',         t1,
      'bTown',         t2,
      'contractCount', contract_count,
      'totalEur',      total_eur,
      'bidKnownN',     bid_known_n,
      'singleBidN',    single_bid_n
    ) ORDER BY total_eur DESC NULLS LAST, t1, t2)
    FROM seg), '[]'::jsonb),
  'points', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'town',          town,
      'loc',           jsonb_build_array(lng, lat),
      'facility',      facility,
      'contractCount', contract_count,
      'totalEur',      total_eur,
      'bidKnownN',     bid_known_n,
      'singleBidN',    single_bid_n
    ) ORDER BY total_eur DESC NULLS LAST, town)
    FROM pt), '[]'::jsonb)
);
$$;
GRANT EXECUTE ON FUNCTION transport_project_map(text[], text, text) TO app_readonly;
