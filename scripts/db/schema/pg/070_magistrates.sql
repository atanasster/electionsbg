-- 070_magistrates.sql — magistrates who declared a commercial company (ИВСС чл. 175а
-- ЗСВ) + their informational financial figures. Source: data/judiciary/
-- magistrate_holdings.json (scripts/judiciary/__write_magistrate_holdings.ts); loaded
-- by scripts/db/load_magistrates_pg.ts. Replaces shipping the 123 KB holdings + 67 KB
-- company-index + 33 KB search JSON — the person page fetches ONE magistrate by name,
-- the company page fetches by EIK, both ~1 KB.

CREATE TABLE IF NOT EXISTS magistrate (
  name              text PRIMARY KEY,
  -- lower-cased, spaces+hyphens collapsed — the person-page lookup key.
  name_norm         text NOT NULL,
  position          text,
  court             text,
  decl_year         int,
  company_count     int NOT NULL DEFAULT 0,
  -- Informational financial figures (лв), best-effort from the declaration.
  bank_cash_lv      numeric,
  securities_lv     numeric,
  real_estate_count int
);
CREATE INDEX IF NOT EXISTS idx_magistrate_name_norm ON magistrate (name_norm);
-- The /judiciary tile is ranked by declared-company count.
CREATE INDEX IF NOT EXISTS idx_magistrate_company_count
  ON magistrate (company_count DESC);

CREATE TABLE IF NOT EXISTS magistrate_company (
  magistrate_name text NOT NULL REFERENCES magistrate (name) ON DELETE CASCADE,
  name            text NOT NULL,
  stake_pct       int,
  eik             text,
  eik_ambiguous   boolean NOT NULL DEFAULT false,
  ord             int NOT NULL -- declaration order, for stable display
);
-- Company page: who declared this EIK.
CREATE INDEX IF NOT EXISTS idx_magistrate_company_eik
  ON magistrate_company (eik) WHERE eik IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_magistrate_company_mag
  ON magistrate_company (magistrate_name);

-- Companies of one magistrate, in declaration order.
CREATE OR REPLACE FUNCTION magistrate_companies_json(p_name text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', name, 'stakePct', stake_pct, 'eik', eik,
    'eikAmbiguous', eik_ambiguous
  ) ORDER BY ord), '[]'::jsonb)
  FROM magistrate_company WHERE magistrate_name = p_name;
$$;

-- One magistrate record for the /person page (financials + companies). Name-matched.
DROP FUNCTION IF EXISTS magistrate_by_name(text);
CREATE OR REPLACE FUNCTION magistrate_by_name(p_norm text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'name', m.name, 'position', m.position, 'court', m.court,
    'year', m.decl_year,
    'financials', jsonb_build_object(
      'bankCashLv', m.bank_cash_lv, 'securitiesLv', m.securities_lv,
      'realEstateCount', m.real_estate_count),
    'companies', magistrate_companies_json(m.name)
  )
  FROM magistrate m WHERE m.name_norm = p_norm LIMIT 1;
$$;

-- Magistrates who declared the company at `eik` (company page) + the decl year.
DROP FUNCTION IF EXISTS magistrate_by_company(text);
CREATE OR REPLACE FUNCTION magistrate_by_company(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'year', (SELECT max(decl_year) FROM magistrate),
    'magistrates', COALESCE(jsonb_agg(jsonb_build_object(
      'name', m.name, 'position', m.position, 'court', m.court,
      'company', mc.name, 'stakePct', mc.stake_pct
    ) ORDER BY m.name), '[]'::jsonb)
  )
  FROM magistrate_company mc JOIN magistrate m ON m.name = mc.magistrate_name
  WHERE mc.eik = p_eik;
$$;

-- Slim roster for the procurement combined search.
DROP FUNCTION IF EXISTS magistrate_search();
CREATE OR REPLACE FUNCTION magistrate_search()
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'year', (SELECT max(decl_year) FROM magistrate),
    'roster', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name', name, 'court', court, 'companies', company_count
    ) ORDER BY name) FROM magistrate), '[]'::jsonb)
  );
$$;

-- Overview for the /judiciary „декларирани дружества" tile — stats + the top
-- `p_limit` by company count (each with its companies + financials). The table now
-- holds the FULL latest-year roster, so the tile filters to company_count > 0; it
-- shows 8 and fetches all HOLDERS on expand (not the 3.1k-strong full roster).
DROP FUNCTION IF EXISTS magistrate_overview(int);
CREATE OR REPLACE FUNCTION magistrate_overview(p_limit int)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH top AS (
    SELECT * FROM magistrate
    WHERE company_count > 0
    ORDER BY company_count DESC, name LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'year', (SELECT max(decl_year) FROM magistrate),
    'stats', jsonb_build_object(
      'withHoldings', (SELECT count(*) FROM magistrate WHERE company_count > 0),
      'rosterTotal', (SELECT count(*) FROM magistrate),
      'totalCompanies', (SELECT count(*) FROM magistrate_company),
      'magistratesScanned', (SELECT coalesce(max(rows_total),0)
        FROM ingest_batches WHERE source = 'magistrate'),
      'resolvedEik', (SELECT count(*) FROM magistrate_company WHERE eik IS NOT NULL)
    ),
    'magistrates', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name', t.name, 'position', t.position, 'court', t.court,
      'financials', jsonb_build_object(
        'bankCashLv', t.bank_cash_lv, 'securitiesLv', t.securities_lv,
        'realEstateCount', t.real_estate_count),
      'companies', magistrate_companies_json(t.name)
    ) ORDER BY t.company_count DESC, t.name) FROM top t), '[]'::jsonb)
  );
$$;

-- Flat browse view for the standalone „виж всички" table (/judiciary/magistrates),
-- served through the generic /api/db/table engine (registry key `magistrate_holdings`
-- in functions/db_table.js). One row per HOLDER (company_count > 0, the 208), with the
-- declared companies flattened to a searchable comma list so a reader can find every
-- magistrate who named a given company. Financials are deliberately NOT exposed here —
-- the browse is about the declared-company links, mirroring the tile.
CREATE OR REPLACE VIEW magistrate_holdings_table AS
  SELECT
    m.name,
    NULLIF(concat_ws(' · ', m.position, m.court), '') AS court,
    m.company_count,
    (SELECT string_agg(mc.name, ', ' ORDER BY mc.ord)
       FROM magistrate_company mc WHERE mc.magistrate_name = m.name) AS companies
  FROM magistrate m
  WHERE m.company_count > 0;
GRANT SELECT ON magistrate_holdings_table TO app_readonly;
