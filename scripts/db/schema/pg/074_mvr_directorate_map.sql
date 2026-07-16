-- 074_mvr_directorate_map.sql — geolocated МВР structures for the /sector/security
-- (Полиция / МВР) marker map.
--
-- mvr_directorate_geo is a tiny STATIC crosswalk (one HQ point per МВР budget-unit
-- EIK), loaded by scripts/db/load_mvr_directorate_map_pg.ts via the same bridge the
-- water-operator map / by-settlement rollup use:
--   EIK -> awarder_seats seat (ekatte) -> data/settlements.json centroid [lng, lat],
-- with an entity-name fallback (ОДМВР/РДПБЗН „— <областен център>" -> that capital;
-- всичко централно -> София) so the ~21 регионални дирекции whose seat did not
-- geo-resolve still land on their oblast capital instead of vanishing.
--
-- mvr_directorate_map() folds the windowed contracts corpus per structure (spend +
-- contract count + single-bid share) onto those points, so the map fetches ONE
-- scope-aware blob instead of geocoding in the browser. Mirrors 073_water_operator_map
-- / 069_court_load / 061_awarder_group_model. Renders off the LIVE contracts corpus —
-- no new ingest. Depends on contracts (001) + awarder_seats (021). SELECT/EXECUTE →
-- app_readonly.

SET check_function_bodies = off;

CREATE TABLE IF NOT EXISTS mvr_directorate_geo (
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
GRANT SELECT ON mvr_directorate_geo TO app_readonly;

-- Geolocated structures + windowed procurement metric. Windowed [from, to) with
-- sargable COALESCE bounds (matches scopeByWindow's half-open, string-compared guard
-- so the awarder_eik index is kept), tag='contract' only — the same basis as
-- awarder_group_model (reference_procurement_eur_sum_basis). Only structures with a
-- point AND ≥1 contract in the window are returned, ranked by spend DESC (the map's
-- colour) with an eik tiebreak for byte-deterministic ordering.
DROP FUNCTION IF EXISTS mvr_directorate_map(text[], text, text);
CREATE OR REPLACE FUNCTION mvr_directorate_map(
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
  'directorates', COALESCE(jsonb_agg(jsonb_build_object(
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
JOIN mvr_directorate_geo g ON g.eik = a.eik
WHERE g.lng IS NOT NULL AND g.lat IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION mvr_directorate_map(text[], text, text) TO app_readonly;
