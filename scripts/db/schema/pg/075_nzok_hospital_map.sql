-- 075_nzok_hospital_map.sql — geolocated НЗОК hospitals for the health-pack map
-- (top of /awarder/121858220). Mirrors 073_water_operator_map.sql: a tiny STATIC geo
-- crosswalk baked at load time, plus a serving fn that folds the LIVE per-hospital
-- НЗОК metrics onto those points so the browser never geocodes.
--
-- nzok_hospital_geo — one HQ point per hospital EIK, resolved by
-- scripts/db/load_nzok_hospital_map_pg.ts via the same bridge the by-settlement
-- rollup + the ВиК map use: EIK -> awarder_seats seat (ekatte) -> settlements.json
-- centroid [lng, lat]. Hospitals whose seat did not geo-resolve are stored with NULL
-- lng/lat and simply omitted from the map. Sofia (ekatte 68134) is pinned in the
-- loader (no settlements.json row), exactly as the court-load writer does.
--
-- nzok_hospital_map() folds three per-hospital metrics onto the points, so the map's
-- metric selector can recolour client-side: latest-period БМП payments (primary),
-- latest-full-year drug overpay, and latest-period clinical-activity case count.
-- Depends on nzok_hospital_payments (045), nzok_drug_overpay_by_hospital (054),
-- nzok_activities (053), awarder_seats (021). SELECT/EXECUTE -> app_readonly.

SET check_function_bodies = off;

CREATE TABLE IF NOT EXISTS nzok_hospital_geo (
  eik          text PRIMARY KEY,
  name         text NOT NULL,
  oblast       text,
  ekatte       text,
  settlement   text,
  municipality text,
  lng          double precision,
  lat          double precision
);
GRANT SELECT ON nzok_hospital_geo TO app_readonly;

-- Geolocated hospitals + live НЗОК metrics. Only hospitals with a point AND a
-- payments row in the latest period are returned. Determinism (see
-- [[reference_pg_payload_determinism]]): money sums ROUND-ed, array ORDER BY a
-- rounded key with an eik tiebreak so local == cloud. `total`/`geocoded` state the
-- coverage honestly (the awarder_seats bridge does not resolve every private clinic).
DROP FUNCTION IF EXISTS nzok_hospital_map();
CREATE OR REPLACE FUNCTION nzok_hospital_map()
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH lp AS (SELECT max(period) AS p FROM nzok_hospital_payments),
-- Per-EIK payments at the latest period (a hospital group can bill through several
-- ЛЗ facilities → sum them).
pay AS (
  SELECT eik, SUM(cumulative_eur) AS payments_eur
  FROM nzok_hospital_payments
  WHERE period = (SELECT p FROM lp) AND eik IS NOT NULL
  GROUP BY eik
),
dyear AS (SELECT max(year) AS y FROM nzok_drug_overpay_by_hospital),
overpay AS (
  SELECT eik, SUM(overpay_eur) AS overpay_eur
  FROM nzok_drug_overpay_by_hospital
  WHERE year = (SELECT y FROM dyear)
  GROUP BY eik
),
ap AS (SELECT max(period) AS p FROM nzok_activities),
act AS (
  SELECT eik, SUM(cases) AS activity_cases
  FROM nzok_activities
  WHERE period = (SELECT p FROM ap) AND eik IS NOT NULL
  GROUP BY eik
),
h AS (
  SELECT g.eik, g.name, g.oblast, g.settlement, g.lng, g.lat,
         ROUND(pay.payments_eur)::bigint                  AS payments_eur,
         ROUND(COALESCE(overpay.overpay_eur, 0))::bigint  AS drug_overpay_eur,
         COALESCE(act.activity_cases, 0)::bigint          AS activity_cases
  FROM pay
  JOIN nzok_hospital_geo g ON g.eik = pay.eik
  LEFT JOIN overpay ON overpay.eik = pay.eik
  LEFT JOIN act     ON act.eik = pay.eik
)
SELECT jsonb_build_object(
  'asOf', to_char((SELECT p FROM lp) + interval '1 month' - interval '1 day', 'YYYY-MM-DD'),
  'total',    (SELECT count(*) FROM h),
  'geocoded', (SELECT count(*) FROM h WHERE lng IS NOT NULL AND lat IS NOT NULL),
  'hospitals', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'eik',  eik,
      'name', name,
      'city', settlement,
      'oblast', oblast,
      'loc',  CASE WHEN lng IS NULL OR lat IS NULL THEN NULL
                   ELSE jsonb_build_array(lng, lat) END,
      'paymentsEur',    payments_eur,
      'drugOverpayEur', drug_overpay_eur,
      'activityCases',  activity_cases
    ) ORDER BY payments_eur DESC, eik), '[]'::jsonb)
    FROM h WHERE lng IS NOT NULL AND lat IS NOT NULL
  )
);
$$;
GRANT EXECUTE ON FUNCTION nzok_hospital_map() TO app_readonly;
