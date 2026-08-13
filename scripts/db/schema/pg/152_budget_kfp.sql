-- 152 — the КФП (консолидирана фискална програма) corpus: the state budget's
-- monthly execution feed and its per-fiscal-year roll-up.
--
-- Plan: docs/plans/budget-hub-v1.md §6.1. Applied by scripts/db/load_budget_pg.ts
-- (which fills it) AND by scripts/db/load_budget_hub_pg.ts (which does not) —
-- see the note on 153 for why the DDL has two appliers and the data has one.
--
-- ── Three properties of this corpus that the schema encodes ────────────────
--
-- 1. КФП LINES ARE CUMULATIVE YEAR-TO-DATE. `budget_kfp_observation` is the
--    raw feed, so a row for 2024-06 carries January-to-June, not June. Summing
--    periods double-counts by roughly n(n+1)/2. `budget_fiscal_year_figure`
--    exists so no consumer has to know that: it holds the ALREADY-RESOLVED
--    full-year figure (the December cumulative, or a seasonal projection), one
--    row per (year, series, basis).
--
-- 2. EVERY MONEY COLUMN IS EUR, AND IS `double precision`. Pre-2026 budget laws
--    are denominated in BGN and FY2026 in EUR; the shards carry both, and only
--    the euro half is stored, with the source denomination kept beside it as
--    provenance. `numeric` is deliberately NOT used: node-postgres serialises
--    it as a STRING, which blanks every money cell on the page while the number
--    is present in the payload — invisible to every row count and to any
--    assertion made through SQL. Migrations 120 and 142 both learned this.
--
-- 3. `months_available` IS NOT COVERAGE. It counts the monthly observations
--    CAPTURED for the year. FY2021 carries 6 with complete = true, because the
--    December cumulative is the whole year regardless of how many intermediate
--    snapshots were kept. A renderer treating it as coverage states something
--    false about a complete year.

-- ── The per-fiscal-year roll-up ───────────────────────────────────────────
--
-- Declared FIRST, above everything that reads it. A `LANGUAGE sql` body is
-- validated at CREATE time, so a function naming a not-yet-created table raises
-- 42P01 — and because exec() sends this file as ONE transaction, the whole
-- migration rolls back: no tables, no functions, no grants. It applies clean on
-- any machine that already has them, which is why this ordering can only fail
-- somewhere else (a cold db:refresh, or the warm Cloud SQL a loader publishes
-- to). 149's header records the same rule for the same reason.

CREATE TABLE IF NOT EXISTS budget_fiscal_year (
  fiscal_year       int PRIMARY KEY,
  as_of             date NOT NULL,
  complete          boolean NOT NULL,
  months_available  int NOT NULL,
  first_period      text,
  last_period       text,
  gdp_eur           double precision,
  -- 'BGN' | 'EUR' — provenance only. Never rendered, never used to convert:
  -- every stored figure is already in euro.
  source_denomination text,
  -- The prior fiscal year a seasonal projection was anchored on, or NULL when
  -- none could be. NULL here plus complete = false is the "partial" state the
  -- screen already models: actual-so-far, no full-year estimate.
  projection_basis  int,
  -- The NATIONAL per-capita denominator. The per-município one is 149's
  -- `obshtina_population` — do not mint a second.
  population        int,
  -- Which population this is: ГРАО permanent and ГРАО current differ
  -- materially (permanent over-counts emigrants) and Census 2021 is a third
  -- answer. A per-resident figure whose denominator is unnamed is the defect
  -- docs/plans/budget-hub-v1.md §7.1 exists to prevent.
  population_basis  text
);

COMMENT ON COLUMN budget_fiscal_year.months_available IS
  'Monthly КФП observations CAPTURED for the year — NOT the months the figures cover. '
  'FY2021 is 6 with complete = true, because the КФП feed is cumulative year-to-date and '
  'its December row is the whole year. Rendering this as coverage is false about a '
  'complete year.';
COMMENT ON COLUMN budget_fiscal_year.gdp_eur IS
  'Nominal BG GDP for the fiscal year, EUR — an ANNUAL figure. A share of it is only '
  'honest against a complete year or a projection, never against actual-so-far.';
COMMENT ON COLUMN budget_fiscal_year.source_denomination IS
  'The currency the source law/feed was denominated in (BGN before 2026, EUR from 2026). '
  'Provenance only — every *_eur column here is already euro.';

-- One resolved full-year figure per (year, series, basis).
--
-- LONG rather than 15 wide columns, because the three bases are the whole point
-- (plan §2.1): executed, planned and projected are all true and a consumer that
-- picks one by accident is the defect. A column named `revenue_eur` invites
-- exactly that; a row keyed on `basis` cannot be read without naming it.
CREATE TABLE IF NOT EXISTS budget_fiscal_year_figure (
  fiscal_year int NOT NULL REFERENCES budget_fiscal_year(fiscal_year) ON DELETE CASCADE,
  -- revenue | expenditure | euContribution | balance | financing
  series      text NOT NULL,
  -- actual | planned | projected
  basis       text NOT NULL,
  amount_eur  double precision NOT NULL,
  PRIMARY KEY (fiscal_year, series, basis)
);

COMMENT ON TABLE budget_fiscal_year_figure IS
  'Resolved FULL-YEAR figures. `actual` is the December cumulative for a complete year '
  'and actual-so-far otherwise; `projected` is a seasonal full-year estimate; `planned` '
  'is the State Budget Law. Never sum across basis, and never render one without saying '
  'which it is.';

-- ── The raw monthly feed ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budget_kfp_observation (
  fiscal_year        int  NOT NULL,
  period             text NOT NULL,   -- 'YYYY-MM'
  series             text NOT NULL,
  constituent_budget text NOT NULL,   -- 'state' today; the feed admits others
  as_of              date NOT NULL,
  cadence            text NOT NULL,
  executed_eur       double precision,
  planned_eur        double precision,
  source_ref         jsonb,
  PRIMARY KEY (fiscal_year, period, series, constituent_budget)
);

COMMENT ON TABLE budget_kfp_observation IS
  'The raw МФ КФП feed, CUMULATIVE year-to-date: a 2024-06 row carries January-June. '
  'Summing periods double-counts by roughly n(n+1)/2 — read budget_fiscal_year_figure '
  'for a full-year number, or take the latest period per year.';

-- The SECTION frame of one period's snapshot.
--
-- Separate from the lines, and not optional, for three measured reasons:
--
--   * `series` is NOT derivable from `kind`. Sections II (Разходи и трансфери)
--     and III (Вноска в общия бюджет на ЕС) are BOTH kind = 'expenditure';
--     their series are 'expenditure' and 'euContribution'. Without this column
--     the only way to tell them apart is to hardcode the roman numeral.
--   * Sections III and IV publish ZERO lines in every year, but do carry a
--     total. Line rows alone therefore make the EU contribution and the deficit
--     simply not exist in the snapshot.
--   * The section total is the PUBLISHED one, not the sum of its lines. Summing
--     all lines double-counts ~2× (subtotals); summing depth = 0 reproduces I
--     and II but misses section V by €25,867.
CREATE TABLE IF NOT EXISTS budget_kfp_snapshot_section (
  fiscal_year  int  NOT NULL,
  period       text NOT NULL,
  section_code text NOT NULL,     -- 'I' | 'II' | 'III' | 'IV' | 'V'
  kind         text NOT NULL,     -- revenue | expenditure | financing | balance
  -- Join key onto budget_fiscal_year_figure.series.
  series       text NOT NULL,
  label_bg     text,
  label_en     text,
  executed_eur double precision,
  planned_eur  double precision,
  PRIMARY KEY (fiscal_year, period, section_code)
);

COMMENT ON COLUMN budget_kfp_snapshot_section.series IS
  'NOT derivable from kind: sections II and III are both ''expenditure'' and III is the EU '
  'contribution. This is the column a consumer joins to budget_fiscal_year_figure.series.';
COMMENT ON COLUMN budget_kfp_snapshot_section.executed_eur IS
  'The PUBLISHED section total — not the sum of its lines. Sections III and IV carry a total '
  'and no lines at all.';

-- The per-line breakdown of one period's snapshot — the revenue/expenditure
-- composition pages. One row per printed line, `line_ord` preserving the
-- source order because the hierarchy is expressed by `depth` + order, not by a
-- parent key the source publishes.
CREATE TABLE IF NOT EXISTS budget_kfp_snapshot_line (
  fiscal_year    int  NOT NULL,
  period         text NOT NULL,
  -- 'I' | 'II' | 'III' | 'IV' | 'V' — FIVE, and III/IV contribute no rows here.
  section_code   text NOT NULL,
  line_ord       int  NOT NULL,
  kind           text NOT NULL,   -- revenue | expenditure | financing | balance
  depth          int  NOT NULL,
  is_subtotal    boolean NOT NULL,
  label_bg       text,
  label_en       text,
  group_label_bg text,
  group_label_en text,
  executed_eur   double precision,
  planned_eur    double precision,
  PRIMARY KEY (fiscal_year, period, section_code, line_ord)
);

COMMENT ON COLUMN budget_kfp_snapshot_line.depth IS
  'Indent level as published. The source gives no parent key, so a tree is rebuilt from '
  '(depth, line_ord) — which is why line_ord must preserve the source order exactly.';

-- ── Indexes ───────────────────────────────────────────────────────────────
--
-- The PK on budget_kfp_observation leads with fiscal_year, so the per-year read
-- is served by it. What it cannot serve is the cross-year time series
-- /budget/execution draws, which scans one series over every year.
CREATE INDEX IF NOT EXISTS idx_budget_kfp_obs_series_period
  ON budget_kfp_observation (series, period);

-- ── RECONCILE for warm databases ──────────────────────────────────────────
--
-- `CREATE TABLE IF NOT EXISTS` is a no-op once the table exists, so every
-- column above must be repeated here or a new one reaches a fresh clone and
-- nothing else — the quiet schema drift that trades a loud failure for an
-- invisible one (003's lesson). Keep the two lists in step; a TYPE change still
-- needs a hand-written ALTER (142 has a worked example).
ALTER TABLE budget_fiscal_year
  ADD COLUMN IF NOT EXISTS first_period        text,
  ADD COLUMN IF NOT EXISTS last_period         text,
  ADD COLUMN IF NOT EXISTS gdp_eur             double precision,
  ADD COLUMN IF NOT EXISTS source_denomination text,
  ADD COLUMN IF NOT EXISTS projection_basis    int,
  ADD COLUMN IF NOT EXISTS population          int,
  ADD COLUMN IF NOT EXISTS population_basis    text;

ALTER TABLE budget_kfp_observation
  ADD COLUMN IF NOT EXISTS executed_eur double precision,
  ADD COLUMN IF NOT EXISTS planned_eur  double precision,
  ADD COLUMN IF NOT EXISTS source_ref   jsonb;

ALTER TABLE budget_kfp_snapshot_line
  ADD COLUMN IF NOT EXISTS label_bg       text,
  ADD COLUMN IF NOT EXISTS label_en       text,
  ADD COLUMN IF NOT EXISTS group_label_bg text,
  ADD COLUMN IF NOT EXISTS group_label_en text,
  ADD COLUMN IF NOT EXISTS executed_eur   double precision,
  ADD COLUMN IF NOT EXISTS planned_eur    double precision;

ALTER TABLE budget_kfp_snapshot_section
  ADD COLUMN IF NOT EXISTS label_bg     text,
  ADD COLUMN IF NOT EXISTS label_en     text,
  ADD COLUMN IF NOT EXISTS executed_eur double precision,
  ADD COLUMN IF NOT EXISTS planned_eur  double precision;

-- ADD CONSTRAINT has no IF NOT EXISTS, so each is guarded on pg_constraint
-- rather than making a re-apply fail.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_fy_figure_basis') THEN
    ALTER TABLE budget_fiscal_year_figure
      ADD CONSTRAINT budget_fy_figure_basis
      CHECK (basis IN ('actual', 'planned', 'projected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_kfp_line_kind') THEN
    ALTER TABLE budget_kfp_snapshot_line
      ADD CONSTRAINT budget_kfp_line_kind
      CHECK (kind IN ('revenue', 'expenditure', 'financing', 'balance'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_kfp_section_kind') THEN
    ALTER TABLE budget_kfp_snapshot_section
      ADD CONSTRAINT budget_kfp_section_kind
      CHECK (kind IN ('revenue', 'expenditure', 'financing', 'balance'));
  END IF;
END $$;

-- Role-guarded: `roles_readonly.sql` is a cluster-wide, hand-run step on Cloud
-- SQL, so app_readonly may not exist on the target. An unguarded GRANT raises
-- 42704 and — because exec() sends a migration as ONE transaction — rolls this
-- whole file back, leaving no tables at all on a cold bootstrap.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON budget_fiscal_year        TO app_readonly;
    GRANT SELECT ON budget_fiscal_year_figure TO app_readonly;
    GRANT SELECT ON budget_kfp_observation      TO app_readonly;
    GRANT SELECT ON budget_kfp_snapshot_section TO app_readonly;
    GRANT SELECT ON budget_kfp_snapshot_line    TO app_readonly;
  END IF;
END $$;
