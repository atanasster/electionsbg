-- 132_transport_facility_map.sql — geolocated transport entities for the
-- /sector/transport (МТС group) marker map.
--
-- transport_facility_geo is a tiny STATIC crosswalk (one point per transport
-- budget-unit EIK), loaded by scripts/db/load_transport_facility_map_pg.ts via
-- the same bridge the МВР / water-operator maps use:
--   EIK -> awarder_seats seat (ekatte) -> data/settlements.json centroid [lng, lat],
-- with a curated PHYSICAL-facility override pinning the two maritime bodies
-- (ИА „Морска администрация", ДП „Пристанищна инфраструктура") to Варна — all 11
-- group entities are Sofia-REGISTERED, so without it the map is a single pin.
--
-- HISTORY: this is the REBUILD of work written 2026-07-16 under migration slot
-- 076 and never committed (076 was since taken by transport_project_map); the
-- orphan table it left on local/prod is adopted by the IF NOT EXISTS below.
-- See docs/plans/db-refresh-loader-gaps-v1.md §5 and transport-view-v1.md.
--
-- transport_facility_map() folds the windowed contracts corpus per entity
-- (spend + contract count + single-bid share) onto those points. Mirrors
-- 074_mvr_directorate_map / 073_water_operator_map. Renders off the LIVE
-- contracts corpus — no new ingest. Depends on contracts (001) + awarder_seats
-- (021). SELECT/EXECUTE → app_readonly.

SET check_function_bodies = off;

CREATE TABLE IF NOT EXISTS transport_facility_geo (
  eik          text PRIMARY KEY,
  name         text NOT NULL,
  universe     text,
  oblast       text,
  ekatte       text,
  settlement   text,
  municipality text,
  lng          double precision,
  lat          double precision
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON transport_facility_geo TO app_readonly;
  END IF;
END $$;

-- Geolocated entities + windowed procurement metric. Windowed [from, to) with
-- sargable COALESCE bounds (matches scopeByWindow's half-open, string-compared
-- guard so the awarder_eik index is kept), tag='contract' only — the same basis
-- as awarder_group_model (reference_procurement_eur_sum_basis). Only entities
-- with a point AND ≥1 contract in the window are returned, ranked by spend DESC
-- with an eik tiebreak for byte-deterministic ordering.
DROP FUNCTION IF EXISTS transport_facility_map(text[], text, text);
CREATE OR REPLACE FUNCTION transport_facility_map(
  p_eiks text[],
  p_from text DEFAULT NULL,
  p_to   text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT awarder_eik, number_of_tenderers, amount_eur
  FROM contracts
  WHERE awarder_eik = ANY(p_eiks) AND tag = 'contract'
    AND date >= COALESCE(p_from, '')
    AND date <  COALESCE(p_to, '99999999')
),
agg AS (
  SELECT awarder_eik AS eik,
         (COUNT(*))::int                                                AS contract_count,
         ROUND(COALESCE(SUM(amount_eur), 0))::double precision          AS total_eur,
         (COUNT(*) FILTER (WHERE number_of_tenderers IS NOT NULL))::int AS bid_known_n,
         (COUNT(*) FILTER (WHERE number_of_tenderers = 1))::int         AS single_bid_n
  FROM base GROUP BY awarder_eik
)
SELECT jsonb_build_object(
  'facilities', COALESCE(jsonb_agg(jsonb_build_object(
    'eik',           g.eik,
    'name',          g.name,
    'universe',      g.universe,
    'oblast',        g.oblast,
    'settlement',    g.settlement,
    'municipality',  g.municipality,
    'loc',           jsonb_build_array(g.lng, g.lat),
    'contractCount', a.contract_count,
    'totalEur',      a.total_eur,
    'bidKnownN',     a.bid_known_n,
    'singleBidN',    a.single_bid_n
  ) ORDER BY a.total_eur DESC NULLS LAST, g.eik), '[]'::jsonb)
)
FROM agg a
JOIN transport_facility_geo g ON g.eik = a.eik
WHERE g.lng IS NOT NULL AND g.lat IS NOT NULL;
$$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION transport_facility_map(text[], text, text) TO app_readonly;
  END IF;
END $$;
