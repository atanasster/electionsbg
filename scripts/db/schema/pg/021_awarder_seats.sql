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
  source       text,
  -- Buyer tier + local-HQ flag (geo-source seats only). Powers the by-settlement
  -- rollup's local-vs-national split (procurement_by_settlement, 030).
  tier         text,
  is_local_hq  boolean
);
-- Older DBs: add the columns if the table predates them.
ALTER TABLE awarder_seats ADD COLUMN IF NOT EXISTS tier text;
ALTER TABLE awarder_seats ADD COLUMN IF NOT EXISTS is_local_hq boolean;
CREATE INDEX IF NOT EXISTS idx_awarder_seats_oblast ON awarder_seats(oblast);
-- by-settlement rollup filters to local-HQ geo-resolved seats + groups by ekatte.
CREATE INDEX IF NOT EXISTS idx_awarder_seats_local
  ON awarder_seats(is_local_hq, source, ekatte);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON awarder_seats TO app_readonly;
  END IF;
END $$;

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

-- The entity's registered seat as a COMPOSED, localizable place (settlement · obshtina ·
-- oblast) resolved through place_dim (117) — for the shared PlaceSeatLine on the awarder /
-- company page, replacing the free-text tr_companies.seat one-liner. Only awarders have an
-- awarder_seats row, so a contractor-only company returns NULL and the page keeps the free-text
-- seat. `settlement`/`obshtina`/`oblast` are the BG names awarder_seats already carries; the
-- place_dim join adds the EN names, the т.в.м. marker and the CODES the seat's drill-up links
-- need (NULL for a name-parsed seat with no EKATTE — the segment then renders unlinked).
DROP FUNCTION IF EXISTS awarder_seat_place(text);
CREATE OR REPLACE FUNCTION awarder_seat_place(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE
    -- A present-but-empty seat row (no settlement/obshtina/oblast at all) resolves to NULL,
    -- so the page falls through to its institution.locality / free-text seat instead of
    -- rendering an all-null PlaceSeatLine.
    WHEN s.settlement IS NULL AND s.municipality IS NULL AND s.oblast IS NULL THEN NULL
    ELSE jsonb_build_object(
      'ekatte',         s.ekatte,
      'settlement',     s.settlement,
      'settlementEn',   pd.name_en,
      'settlementType', pd.settlement_type,
      -- Emit codes in the GOVERNANCE vocabulary the seat links resolve against, not the raw
      -- place_dim codes: Sofia city's obshtina is 'SFO_CITY' here but '/governance/SOF00' in
      -- the app, so use the crosswalk governance_code the SFO_CITY row carries. And the
      -- statistical fold 'SOFIA_CITY' has no /governance/region page (Sofia the город is a
      -- município that is its own oblast), so drop the oblast code → the segment renders as
      -- plain text rather than a link to nowhere. Every other обшina/област code IS already
      -- the governance code, so both COALESCE/CASE are no-ops for them.
      'obshtinaCode',   COALESCE(ob.governance_code, pd.obshtina_code),
      'obshtina',       COALESCE(ob.name_bg, s.municipality),
      'obshtinaEn',     ob.name_en,
      'oblastCode',     CASE WHEN pd.oblast_code = 'SOFIA_CITY' THEN NULL ELSE pd.oblast_code END,
      'oblast',         COALESCE(obl.name_bg, s.oblast),
      'oblastEn',       obl.name_en
    )
  END
  FROM awarder_seats s
  LEFT JOIN place_dim pd  ON pd.kind = 'settlement' AND pd.code = s.ekatte
  LEFT JOIN place_dim ob  ON ob.kind = 'obshtina'   AND ob.code = pd.obshtina_code
  LEFT JOIN place_dim obl ON obl.kind = 'oblast'    AND obl.code = pd.oblast_code
  WHERE s.eik = p_eik;
$$;
