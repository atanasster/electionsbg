-- 072_excise_warehouses.sql — geolocated VALID (active) excise warehouses (данъчни
-- складове), the count map at the top of /customs/warehouses. Source:
-- data/customs/excise_warehouses.json (scripts/customs/excise_register.ts, one row
-- per active warehouse placed at its own address's settlement centroid); loaded by
-- scripts/db/load_excise_warehouses_pg.ts. The register TABLE on that screen still
-- reads the operator-level JSON; only the MAP is Postgres-backed.

CREATE TABLE IF NOT EXISTS excise_warehouses (
  id       serial PRIMARY KEY,
  eik      text NOT NULL,        -- operator EIK → /company/:eik
  name     text NOT NULL,        -- operator name
  category text NOT NULL,        -- energy | tobacco | alcohol | other
  place    text,                 -- display settlement, e.g. "гр. Бургас"
  oblast   text,                 -- BACIS oblast name
  lng      double precision,
  lat      double precision
);
-- The map fetches every geolocated warehouse in one shot; keep an index on the
-- geo predicate so the serving scan stays cheap as the register grows.
CREATE INDEX IF NOT EXISTS idx_excise_warehouses_geo
  ON excise_warehouses (lng, lat) WHERE lng IS NOT NULL AND lat IS NOT NULL;

-- Every geolocated warehouse as the map payload. One point per warehouse; the
-- client (SectorPointMap) groups them into one marker per city. Ordered by
-- category then operator for a stable, deterministic pager.
DROP FUNCTION IF EXISTS excise_warehouses_map();
CREATE OR REPLACE FUNCTION excise_warehouses_map()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'warehouses', COALESCE(jsonb_agg(jsonb_build_object(
      'eik', eik,
      'name', name,
      'category', category,
      'place', place,
      'oblast', oblast,
      'loc', jsonb_build_array(lng, lat)
    ) ORDER BY category, name, id), '[]'::jsonb)
  )
  FROM excise_warehouses
  WHERE lng IS NOT NULL AND lat IS NOT NULL;
$$;
