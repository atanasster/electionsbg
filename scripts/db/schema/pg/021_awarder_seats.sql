-- Awarder seats (buyer HQ: settlement · município · oblast) → PG, so the DB
-- company page can build a GEOGRAPHIC FOOTPRINT of a contractor entirely from
-- Postgres: where it wins (distribution of contract value across the buyers'
-- oblasti) + where its EU projects are (fund_projects.oblast). Loaded by
-- load_awarder_seats_pg.ts (computeAwarderSeats() — the same resolver the JSON
-- awarder enrichment uses: geo EKATTE, else a unique name-parsed settlement).
--
-- Needed because contracts.awarder_region is 93% NULL — the resolved seat covers
-- 98% of contract VALUE (big buyers resolve). Depends on contracts (001),
-- tr_companies. SELECT/EXECUTE auto-granted to app_readonly.

SET check_function_bodies = off;

CREATE TABLE IF NOT EXISTS awarder_seats (
  eik          text PRIMARY KEY,
  ekatte       text,
  settlement   text,
  municipality text,
  oblast       text,
  is_village   boolean,
  source       text
);
CREATE INDEX IF NOT EXISTS idx_awarder_seats_oblast ON awarder_seats(oblast);
GRANT SELECT ON awarder_seats TO app_readonly;

-- Where a contractor WINS: distribution of its contract value across the buyers'
-- oblasti (the "operates statewide vs one region" / home-region-capture signal),
-- + the unknown-seat remainder so the UI is honest about coverage, + the firm's
-- own registered seat. Funds geography is intentionally out (fund_projects.oblast
-- is a different code system; EU-project location lives on the funds drill-down).
DROP FUNCTION IF EXISTS company_geography(text);
CREATE OR REPLACE FUNCTION company_geography(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH pc AS (
  SELECT s.oblast, c.amount_eur
  FROM contracts c
  LEFT JOIN awarder_seats s ON s.eik = c.awarder_eik
  WHERE c.contractor_eik = p_eik AND c.tag = 'contract'
),
proc AS (
  SELECT oblast, ROUND(SUM(amount_eur)) AS eur, (COUNT(*))::int AS n
  FROM pc WHERE oblast IS NOT NULL GROUP BY oblast
),
proc_unknown AS (
  SELECT ROUND(COALESCE(SUM(amount_eur), 0)) AS eur, (COUNT(*))::int AS n
  FROM pc WHERE oblast IS NULL
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM proc) THEN NULL
  ELSE jsonb_build_object(
    'procurement', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('oblast', oblast, 'eur', eur, 'count', n)
        ORDER BY eur DESC NULLS LAST), '[]'::jsonb) FROM proc
    ),
    'unknownEur', (SELECT eur FROM proc_unknown),
    'unknownCount', (SELECT n FROM proc_unknown),
    'homeSeat', (SELECT seat FROM tr_companies WHERE uic = p_eik)
  )
END;
$$;
