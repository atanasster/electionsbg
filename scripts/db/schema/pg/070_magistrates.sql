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
  -- NOT NULL because every count captioned in the present tense filters on it, and
  -- `decl_year = max(decl_year)` is NULL-FALSE: one row written without a year would
  -- vanish from the /court card, the search ranking, the /judiciary tile and the
  -- prerender at once, with every row count reconciling and nothing red. The writer
  -- always has one (`m.declYear ?? file.year`, where the file-level year is required),
  -- so this constrains what is already true. Warm databases get it from the reconcile
  -- at the foot of this file — see there for why that one cannot be unconditional.
  decl_year         int NOT NULL,
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

-- ==========================================================================
-- THE CURRENT BENCH — the one definition every present-tense count reads.
--
-- `magistrate` retains a magistrate who has left the bench, keyed to their last annual
-- filing, so the ИВСС register's yearly turnover stops deleting their person row and
-- 404ing their /person URL (462 of them in 2026 — see the roster comment in
-- scripts/judiciary/__write_magistrate_holdings.ts). Every figure captioned in the
-- present tense („с декларации в ИВСС", „за <година> г.") therefore wants THIS, not the
-- table: counting a 2019 filing into one leaves the arithmetic right and the sentence
-- false.
--
-- WHY A VIEW RATHER THAN THE PREDICATE REPEATED. It was repeated — six times across
-- three files and two languages — and "someone missed one" fired TWICE IN ONE DAY:
-- 5325a6ef37 scoped the two counts in 116 and missed the third in seo_courts.ts, which
-- fabf683666 then fixed hours later after a gate caught the /court card and the
-- prerendered page disagreeing. A seventh consumer would inherit the same coin flip.
-- Named once, there is no predicate left to forget.
--
-- CREATE OR REPLACE, NEVER DROP. Once 116's two functions and magistrate_holdings_table
-- below read this, a `DROP VIEW` in a loader-applied migration is the 2BP01 that stalled
-- db:load:pg for a day (077/145), and `DROP … CASCADE` is the silent variant that
-- deleted three matviews on every TR load (003). This file is applied by
-- load_magistrates_pg.ts on every magistrate load, which is exactly that position.
--
-- `SELECT *` is deliberate: a pass-through view cannot drift from its table, and
-- CREATE OR REPLACE VIEW permits appending a column, so a new `magistrate` column
-- reaches consumers without a second column list to keep in step.
CREATE OR REPLACE VIEW magistrate_current AS
  SELECT * FROM magistrate
   WHERE decl_year = (SELECT max(decl_year) FROM magistrate);

-- roles_readonly.sql's ALTER DEFAULT PRIVILEGES already covers a view created by
-- postgres; this is the explicit belt-and-braces 070 keeps for its other view. Guarded
-- because roles_readonly.sql is a one-time MANUAL step — unguarded it raises 42704 on a
-- cold bootstrap and rolls back the whole file, leaving no view at all.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON magistrate_current TO app_readonly;
  END IF;
END $$;

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
  -- Current bench only, for the same reason magistrate_overview() scopes: the payload
  -- carries ONE `year` for the whole list, so a retained magistrate's older filing would
  -- be published under the latest year's label. Keeping this scoped also means the
  -- roster retention adds nothing to the company page that was not already there.
  FROM magistrate_company mc JOIN magistrate_current m ON m.name = mc.magistrate_name
  WHERE mc.eik = p_eik;
$$;

-- TOMBSTONE — `magistrate_search()` is RETIRED (2026-08-11). DROP, no CREATE, the same shape
-- 025/031 use for the two cache matviews 124 replaced.
--
-- It was the whole-roster payload for the procurement combined search, and it was the one
-- consumer deliberately left UNSCOPED when this table stopped tracking the latest year and
-- began retaining departed magistrates: a magistrate who left the bench is exactly who a
-- reader searching an old name is looking for. That reasoning was sound; the function had
-- simply stopped being how the site delivers it. a1900e91de (2026-08-01) replaced the client
-- roster (`useMagistrateSearchRoster`) with the ranked /api/db/person-search index and
-- removed the hook, but not this function or its route — so for ten days it served 432 KB
-- to nobody, and grew with the roster in a payload-ceiling gate that budgeted for it.
--
-- Retiring it costs no findability, which is the only thing that made it worth keeping:
-- every magistrate — CURRENT BENCH AND RETAINED — resolves to a person row and lands in
-- person_browse_table at tier 'P', which is exactly what person_search's P arm selects.
-- Measured 2026-08-11: 3,594 of 3,594 magistrate rows carry a `person_role`, and all 3,594
-- (3,134 current + 460 retained) sit at tier 'P'.
--
-- The corollary is a STALENESS trigger, not a structural gap, and it is the thing to get
-- right: person_search is a standalone loader, so a magistrate roster reload does not reach
-- the search index by itself. Until `db:load:person-search:pg[:cloud]` re-runs, the retained
-- magistrates are unfindable there — measured on this database mid-change, 393 of the 460
-- were missing from person_search while all 460 were already in person_browse_table. That is
-- the retention's own purpose defeated, at a 200, with every row count reconciling.
--
-- No dependents to break: checked against pg_proc bodies, pg_rewrite view definitions and
-- pg_depend — the function was a leaf, called only by the dead route.
--
-- The DROP rides `db:load:magistrates:pg[:cloud]` (load_magistrates_pg.ts applies this file),
-- so no hand-run apply_functions step is owed. Deploy order does not matter either: the route
-- is already gone, and `missingMigrationEmpty` degraded a 42883 from it anyway.
DROP FUNCTION IF EXISTS magistrate_search();

-- Overview for the /judiciary „декларирани дружества" tile — stats + the top
-- `p_limit` by company count (each with its companies + financials). The table spans
-- YEARS (it retains departed magistrates — see the `cur` CTE below), so the tile scopes
-- to the current bench and filters to company_count > 0; it shows 8 and fetches all
-- HOLDERS on expand (not the full roster).
DROP FUNCTION IF EXISTS magistrate_overview(int);
CREATE OR REPLACE FUNCTION magistrate_overview(p_limit int)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH cur AS (
    -- Every figure below is scoped to the current bench — this tile labels everything
    -- „за <year> г.", so counting a 2019 filing into it would leave the arithmetic right
    -- and the sentence false. The retained rows are still served individually by
    -- magistrate_by_name(), which carries each magistrate's OWN year. See
    -- magistrate_current above for what the view is and why the rule lives there.
    SELECT * FROM magistrate_current
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
  -- Current bench only — this browse is the tile's „виж всички", so its row count has to
  -- reconcile with the tile's `withHoldings`. See magistrate_current for why the table
  -- itself spans years.
  FROM magistrate_current m
  WHERE m.company_count > 0;
-- Role-guarded for the same reason as magistrate_current's grant above — and once one
-- of this file's two grants is guarded, leaving the other bare is worse than either
-- choice on its own, because it reads as though the guard were optional. It is not:
-- exec() sends this file as ONE implicit transaction, so on a database where the
-- manual roles_readonly.sql has never run, a bare GRANT raises 42704 and rolls back
-- every table, index and function above it — aborting db:load:magistrates:pg on a
-- fresh clone. Same shape as 046's single grant, which was guarded for exactly this.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON magistrate_holdings_table TO app_readonly;
  END IF;
END $$;

-- ==========================================================================
-- Reconcile for WARM databases — CREATE TABLE IF NOT EXISTS above is a no-op on them,
-- so a column constraint added to it reaches only fresh clones (the same trap 003's
-- reconcile block exists for).
--
-- GUARDED rather than a bare ALTER, and the guard is the whole point. load_magistrates_pg.ts
-- applies this file at line 63 and TRUNCATEs + reloads at line 90 — schema FIRST — so an
-- unconditional SET NOT NULL against a database still holding a legacy NULL row would abort
-- the loader in the APPLY phase, before the reload that would have cleaned it. That is the
-- 077 shape exactly: the ingest reports success, the corpus keeps the previous vintage, and
-- nothing is red. A database that cannot take the constraint is told and keeps working;
-- magistrate_roster_retention.data.test.ts is what fails loudly on an actual NULL.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM magistrate WHERE decl_year IS NULL) THEN
    RAISE WARNING 'magistrate.decl_year holds NULLs — NOT NULL not applied. Every current-bench count silently drops those rows (decl_year = max(...) is NULL-false). Reload with db:load:magistrates:pg, then re-apply this file.';
  ELSE
    ALTER TABLE magistrate ALTER COLUMN decl_year SET NOT NULL;
  END IF;
END $$;
