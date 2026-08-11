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
--
-- The ORDER BY is load-bearing, not cosmetic. `name_norm` is NOT unique — it collapses case,
-- spaces and hyphens — and the table now spans years, so one magistrate can hold two rows
-- (and two genuine namesakes always could). An unordered LIMIT 1 then picks arbitrarily:
-- measured 2026-08-11, a serving judge's /person page published her 2025 declared cash
-- (33,512 лв) while her 2026 filing (40,594 лв) sat in the same table. The payload's own
-- 'year' field makes that self-consistent rather than obviously wrong, which is what makes it
-- easy to miss. Newest filing wins; `name` breaks the tie so the pick is stable across
-- reloads. Gate: magistrate_roster_retention.data.test.ts.
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
  FROM magistrate m WHERE m.name_norm = p_norm
  ORDER BY m.decl_year DESC NULLS LAST, m.name
  LIMIT 1;
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
  WHERE mc.eik = p_eik
    -- Current bench only, for the same reason magistrate_overview() scopes: the payload
    -- carries ONE `year` for the whole list, so a retained magistrate's older filing would
    -- be published under the latest year's label. Keeping this scoped also means the
    -- roster change below adds nothing to the company page that was not already there.
    AND m.decl_year = (SELECT max(decl_year) FROM magistrate);
$$;

-- Slim roster for the procurement combined search. Deliberately NOT scoped to the current
-- bench, unlike the tile/browse/company surfaces above: this one exists to FIND a named
-- person, and a magistrate who left the bench is exactly who a reader searching an old
-- name is looking for. It publishes no year-labelled claim about them — `year` here is the
-- register's latest, and each row carries only name/court/company-count.
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
-- `p_limit` by company count (each with its companies + financials). The table spans
-- YEARS (it retains departed magistrates — see the `cur` CTE below), so the tile scopes
-- to the current bench and filters to company_count > 0; it shows 8 and fetches all
-- HOLDERS on expand (not the full roster).
DROP FUNCTION IF EXISTS magistrate_overview(int);
CREATE OR REPLACE FUNCTION magistrate_overview(p_limit int)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH cur AS (
    -- THE CURRENT BENCH, and every figure below is scoped to it.
    --
    -- `magistrate` no longer tracks one year: it retains a magistrate who has left the
    -- bench, keyed to their last annual filing, so the register's yearly turnover stops
    -- deleting their person row and 404ing their /person URL (462 of them in 2026 — see
    -- the roster comment in scripts/judiciary/__write_magistrate_holdings.ts). This tile
    -- labels everything „за <year> г.", so counting a 2019 filing into it would leave the
    -- arithmetic right and the sentence false. The retained rows are still served
    -- individually by magistrate_by_name(), which carries each magistrate's OWN year.
    SELECT * FROM magistrate
     WHERE decl_year = (SELECT max(decl_year) FROM magistrate)
  ),
  top AS (
    SELECT * FROM cur
    WHERE company_count > 0
    ORDER BY company_count DESC, name LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'year', (SELECT max(decl_year) FROM magistrate),
    'stats', jsonb_build_object(
      'withHoldings', (SELECT count(*) FROM cur WHERE company_count > 0),
      'rosterTotal', (SELECT count(*) FROM cur),
      'totalCompanies', (SELECT count(*) FROM magistrate_company mc
                          JOIN cur c ON c.name = mc.magistrate_name),
      'magistratesScanned', (SELECT coalesce(max(rows_total),0)
        FROM ingest_batches WHERE source = 'magistrate'),
      'resolvedEik', (SELECT count(*) FROM magistrate_company mc
                       JOIN cur c ON c.name = mc.magistrate_name
                      WHERE mc.eik IS NOT NULL)
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
  WHERE m.company_count > 0
    -- Current bench only — this browse is the tile's „виж всички", so its row count has to
    -- reconcile with the tile's `withHoldings`. See magistrate_overview() for why the
    -- table itself now spans years.
    AND m.decl_year = (SELECT max(decl_year) FROM magistrate);
GRANT SELECT ON magistrate_holdings_table TO app_readonly;
