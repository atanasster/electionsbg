-- 069_court_load.sql — per-court натовареност (ВСС Приложение № 2), served per year.
-- Source: data/judiciary/court_load.json (scripts/judiciary/__write_court_load.ts);
-- loaded by scripts/db/load_court_load_pg.ts. Replaces shipping the 531 KB all-years
-- JSON to every /judiciary visitor with a per-year serving fn (~66 KB/year).

CREATE TABLE IF NOT EXISTS court_load (
  year               int  NOT NULL,
  name               text NOT NULL,
  tier               text NOT NULL,
  place              text,
  lng                double precision,
  lat                double precision,
  judges             int,
  person_months      numeric,
  filed_per_month    numeric,
  consider_per_month numeric,
  resolved_per_month numeric,
  PRIMARY KEY (year, name)
);
-- The map fetches one year at a time; the PK's leading `year` already serves it,
-- but keep an explicit index so a year scan is an index range even if the PK is
-- dropped/reordered later.
CREATE INDEX IF NOT EXISTS idx_court_load_year ON court_load (year);

-- One year's courts as the map payload (busiest first, name tiebreak for stability).
DROP FUNCTION IF EXISTS court_load_year(int);
CREATE OR REPLACE FUNCTION court_load_year(p_year int)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'year', p_year,
    'courts', COALESCE(jsonb_agg(jsonb_build_object(
      'name', name,
      'tier', tier,
      'place', place,
      'loc', CASE WHEN lng IS NULL OR lat IS NULL THEN NULL
                  ELSE jsonb_build_array(lng, lat) END,
      'judges', judges,
      'personMonths', person_months,
      'filedPerMonth', filed_per_month,
      'considerPerMonth', consider_per_month,
      'resolvedPerMonth', resolved_per_month
    ) ORDER BY resolved_per_month DESC NULLS LAST, name), '[]'::jsonb)
  )
  FROM court_load WHERE year = p_year;
$$;

-- The available years (newest first) for the year picker.
DROP FUNCTION IF EXISTS court_load_years();
CREATE OR REPLACE FUNCTION court_load_years()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(y ORDER BY y DESC), '[]'::jsonb)
  FROM (SELECT DISTINCT year AS y FROM court_load) t;
$$;
