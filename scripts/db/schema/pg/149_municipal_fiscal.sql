-- 149_municipal_fiscal.sql — per-município quarterly financial indicators
-- (ЗПФ чл. 130г ал. 2), the corpus behind the „поети ангажименти" surfaces.
--
-- WHY THIS EXISTS. Bulgarian public finance distinguishes THREE nested
-- liability stocks, and until this table the repo held only the innermost, as
-- one national number a year:
--
--   поети ангажименти за разходи   CONTRACTED, unperformed at period end, due
--                                  for execution in whole or in part in
--                                  FOLLOWING budget years. ~€3.4-4.2bn.
--   задължения за разходи          INVOICED, not yet past term.
--   просрочени задължения          OVERDUE. ~€73-75m — 1/46th of the first.
--
-- Any claim about "pushing payments into the next budget year" is about the
-- OUTERMOST stock, which the arrears statistic can never see: a payment
-- contractually scheduled for next year is never просрочено. That is why flat
-- national arrears were read as evidence of health while municipal CONTRACTED
-- value ran 2.8× — see docs/analysis/deficit-deferral-claim-v1.md.
--
-- GRAIN is (obshtina, fiscal_year, quarter). The справка is QUARTERLY (ИСО,
-- чл. 133 + чл. 167 ЗПФ), but the чл. 130а criteria are annual by construction
-- („налични към края на ГОДИНАТА"), so `criteria_met` / `meets_threshold` are
-- populated on Q4 rows ONLY and NULL elsewhere. A mid-year distress verdict
-- would be a fabrication, and it is exactly the figure that gets quoted once it
-- exists.
--
-- SOFIA is the synthetic `SOF00`. `data/municipalities.json` carries only the
-- 24 S2xxx districts, and place_dim keys the city-wide row `SFO_CITY` — so a
-- place_dim join for Sofia is on `governance_code`, NOT on `code`.
--
-- Loader: scripts/db/load_municipal_fiscal_pg.ts (applies this file).
-- Plan: docs/plans/municipal-fiscal-commitments-v1.md (T2.1).

CREATE TABLE IF NOT EXISTS municipal_fiscal (
  obshtina                text NOT NULL,
  -- МФ/ЕБК code as published (5101 Банско … 7805). Kept beside the resolved
  -- obshtina because it is the SOURCE key: a coverage change is visible as an
  -- mf_code appearing or vanishing, which a row count reads as ordinary churn.
  mf_code                 int  NOT NULL,
  fiscal_year             int  NOT NULL,
  -- No DEFAULT: the quarterly grain is real, so a caller must state it rather
  -- than silently landing every row on Q4.
  quarter                 smallint NOT NULL,

  -- the three stocks
  commitments_eur         double precision,
  expense_obligations_eur double precision,
  arrears_eur             double precision,

  -- the fiscal position
  revenue_eur             double precision,
  expenditure_eur         double precision,
  budget_balance_eur      double precision,
  cash_on_hand_eur        double precision,
  debt_stock_eur          double precision,

  -- denominators (derived; see the column comment on expenditure_avg4y_eur)
  expenditure_avg4y_eur   double precision,
  own_revenue_avg3y_eur   double precision,

  -- native unit as published, so a unit-detection error is visible in SQL
  -- rather than only as a silent 1.95583x across the 2026 changeover
  currency                text,

  -- published ratios, as PERCENT (the workbook holds fractions)
  arrears_pct             double precision,
  obligations_pct         double precision,
  commitments_pct         double precision,
  -- Which denominator the SOURCE used, per ratio. At Q4 the three differ:
  -- arrears divides by ACTUAL expenditure, the other two by the 4-year average.
  arrears_basis           text,
  obligations_basis       text,
  commitments_basis       text,

  -- the eight РМС 436/2017 financial-sustainability indicators. Stored because
  -- the parser fills them on every row and serving is PG-only (T2.7) — without
  -- a column they are permanently unservable, and re-ingesting to add them
  -- later means re-downloading workbooks by hand.
  ind_revenue_share_pct        double precision,
  ind_local_coverage_pct       double precision,
  ind_balance_share_pct        double precision,
  ind_debt_to_own_revenue_pct  double precision,
  ind_debt_per_capita          double precision,
  ind_arrears_to_own_rev_pct   double precision,
  ind_population_per_employee  double precision,
  ind_wage_share_pct           double precision,
  ind_capital_share_pct        double precision,

  -- local-tax collection (year-end only)
  collection_dni_pct      double precision,
  collection_dprs_pct     double precision,
  collection_avg_pct      double precision,

  -- чл. 130а verdicts — Q4 only, NULL elsewhere.
  criteria_met            smallint[],
  -- WHICH of the six criteria this row could evaluate at all. Load-bearing:
  -- the workbook publishes no debt-SERVICE figure (indicator 4.1 is the debt
  -- STOCK), so т. 1 is not computable from this source; т. 5 needs three
  -- consecutive years; т. 6 needs the national collection mean. Without this
  -- column a consumer reads „2 criteria met" as „2 of 6" when it may be
  -- „2 of the 3 we could check" — and the ≥3 rule turns on exactly that.
  criteria_evaluable      smallint[],
  meets_threshold         boolean,
  -- From the SEPARATE „общини фин. оздр." sheet. NEVER derived.
  in_recovery_procedure   boolean NOT NULL DEFAULT false,

  -- Fields suppressed for this row because the source froze the column and
  -- carried it forward (see the ingest's rule 2). NULL here means "not
  -- published"; a name listed here means "published, but under the wrong
  -- quarter, so withheld" — a distinction a coalesce to 0 destroys, and the
  -- only thing that lets a national series say WHY a quarter is missing.
  suppressed_fields       text[],

  name_bg                 text,
  source_file             text,
  PRIMARY KEY (obshtina, fiscal_year, quarter),
  -- The source key must stay 1:1 with the resolved one within a period, or a
  -- crosswalk regression silently folds two municipalities onto one row.
  UNIQUE (mf_code, fiscal_year, quarter),
  CONSTRAINT municipal_fiscal_quarter_range CHECK (quarter BETWEEN 1 AND 4),
  -- The чл. 130а criteria are annual by construction („налични към края на
  -- ГОДИНАТА"). The header calls a mid-year verdict a fabrication; this is what
  -- stops one being written.
  CONSTRAINT municipal_fiscal_verdicts_are_yearend CHECK (
    quarter = 4
    OR (criteria_met IS NULL AND criteria_evaluable IS NULL AND meets_threshold IS NULL)
  )
);

-- Every money column is `double precision`, never `numeric`: node-postgres
-- serializes numeric as a STRING, which renders every money cell blank in the
-- browser while the number is present in the payload — invisible to row counts
-- and to any assertion made through SQL. This repo has shipped that defect
-- twice (120's matview, 142's open_calls, whose retype needed a reconcile
-- ALTER because CREATE TABLE IF NOT EXISTS cannot retype a warm column).

COMMENT ON COLUMN municipal_fiscal.commitments_eur IS
  'Поети ангажименти за разходи — end balance of сметка 9200 (СБО, отчетна група „Бюджет"). '
  'Contracted and unperformed at period end, due for execution in whole or in part in '
  'following budget years. Source: the municipality''s own trial balance.';
COMMENT ON COLUMN municipal_fiscal.expense_obligations_eur IS
  'Задължения за разходи — раздел 4 СБО end balances, excluding personnel, pensions, debt '
  'interest, taxes and public receivables, and excluding provisions, debt and commitments. '
  'Computed by МФ rather than self-reported.';
COMMENT ON COLUMN municipal_fiscal.arrears_eur IS
  'Просрочени задължения — задбалансови сметки 9921-9929. SELF-REPORTED by the municipality '
  'and not audited; it is one of the six чл. 130а criteria (three or more must be met), so '
  'the party a finding falls on is the one that files it. Never present it as audited.';
COMMENT ON COLUMN municipal_fiscal.cash_on_hand_eur IS
  'Налични средства (вкл. преводи в процес на сетълмент) — the municipality''s own cash '
  'position. Comparable in spirit to the national фискален резерв, not defined against it.';
COMMENT ON COLUMN municipal_fiscal.expenditure_avg4y_eur IS
  'Средногодишни отчетени разходи за последните 4 години — the чл. 130а т. 2 / т. 3 '
  'denominator, which the workbook does NOT publish. Recovered as commitments ÷ '
  'commitments_pct on year-end rows. NULL off Q4 and whenever either input is missing.';
COMMENT ON COLUMN municipal_fiscal.meets_threshold IS
  'Three or more чл. 130а ал. 1 criteria met — which OBLIGES the municipality to open a '
  'чл. 130д recovery procedure. This is NOT the same fact as in_recovery_procedure: being '
  'IN one persists across years, can begin the year after, and can continue after the '
  'criteria stop being met. Conflating them mislabels municipalities in both directions.';
COMMENT ON COLUMN municipal_fiscal.in_recovery_procedure IS
  'Formally in a чл. 130д финансово оздравяване procedure, as published on the workbook''s '
  'own „общини фин. оздр." sheet. An administratively recorded state — never derived from '
  'the criteria.';

-- RECONCILE for warm databases. `CREATE TABLE IF NOT EXISTS` is a no-op once
-- the table exists, so every column above must be repeated here or a new one
-- reaches a fresh clone and nothing else — the quiet schema drift that trades
-- a loud failure for an invisible one. Keep the two lists in step; a TYPE
-- change still needs a hand-written ALTER (142 has a worked example).
ALTER TABLE municipal_fiscal
  ADD COLUMN IF NOT EXISTS own_revenue_avg3y_eur       double precision,
  ADD COLUMN IF NOT EXISTS currency                    text,
  ADD COLUMN IF NOT EXISTS ind_revenue_share_pct       double precision,
  ADD COLUMN IF NOT EXISTS ind_local_coverage_pct      double precision,
  ADD COLUMN IF NOT EXISTS ind_balance_share_pct       double precision,
  ADD COLUMN IF NOT EXISTS ind_debt_to_own_revenue_pct double precision,
  ADD COLUMN IF NOT EXISTS ind_debt_per_capita         double precision,
  ADD COLUMN IF NOT EXISTS ind_arrears_to_own_rev_pct  double precision,
  ADD COLUMN IF NOT EXISTS ind_population_per_employee double precision,
  ADD COLUMN IF NOT EXISTS ind_wage_share_pct          double precision,
  ADD COLUMN IF NOT EXISTS ind_capital_share_pct       double precision,
  ADD COLUMN IF NOT EXISTS criteria_evaluable          smallint[],
  ADD COLUMN IF NOT EXISTS suppressed_fields           text[];

-- The constraints are added separately: ADD CONSTRAINT has no IF NOT EXISTS,
-- so each is guarded on pg_constraint rather than making a re-apply fail.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'municipal_fiscal_quarter_range') THEN
    ALTER TABLE municipal_fiscal
      ADD CONSTRAINT municipal_fiscal_quarter_range CHECK (quarter BETWEEN 1 AND 4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'municipal_fiscal_verdicts_are_yearend') THEN
    ALTER TABLE municipal_fiscal
      ADD CONSTRAINT municipal_fiscal_verdicts_are_yearend CHECK (
        quarter = 4
        OR (criteria_met IS NULL AND criteria_evaluable IS NULL AND meets_threshold IS NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'municipal_fiscal_mf_code_fiscal_year_quarter_key') THEN
    ALTER TABLE municipal_fiscal
      ADD CONSTRAINT municipal_fiscal_mf_code_fiscal_year_quarter_key
      UNIQUE (mf_code, fiscal_year, quarter);
  END IF;
END $$;

-- The national browse ranks year-end rows by the чл. 130а т. 3 ratio — which
-- the plan's audit #12 chose over per-resident precisely because it normalises
-- by the município's own fiscal capacity. Keyed on that, not on
-- `meets_threshold`: the verdict column is NULL until all six criteria are
-- evaluable (see `criteria_evaluable`), so an index on it would sort nothing.
CREATE INDEX IF NOT EXISTS idx_municipal_fiscal_yearend
  ON municipal_fiscal (fiscal_year, commitments_pct DESC)
  WHERE quarter = 4;

-- No separate (obshtina, …) index: the PRIMARY KEY already leads with
-- `obshtina`, so the per-município time series and the governance tile are
-- served by it. A second index on the same leading column would be paid for on
-- every write and read by nothing.

-- Role-guarded: `roles_readonly.sql` is a cluster-wide, hand-run step on Cloud
-- SQL, so app_readonly may not exist on the target. An unguarded GRANT raises
-- 42704 and — because exec() sends a migration as ONE transaction — rolls this
-- whole file back, leaving no table at all on a cold bootstrap.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON municipal_fiscal TO app_readonly;
  END IF;
END $$;
