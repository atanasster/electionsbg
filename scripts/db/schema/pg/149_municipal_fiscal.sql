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

-- The national browse filters year-end rows; the browse now ORDERs by commitments per resident, so this serves the WHERE rather than the sort — which
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

-- ---------------------------------------------------------------------------
-- Serving layer. Kept in this file rather than a sibling migration so the
-- loader's "applies 149" covers the functions too — a serving function in its
-- own file is the "applied, never loaded" shape CLAUDE.md warns about, where a
-- body fix reaches local and never reaches the serving database.
--
-- The place label joins on COALESCE(governance_code, code): ordinary общини are
-- keyed by `code` (RSE27), while Sofia's city-wide row is `SFO_CITY` carrying
-- `governance_code = 'SOF00'`. Joining on `code` alone leaves the largest
-- município in the country nameless.
-- ---------------------------------------------------------------------------

-- Population per município, so the browse can rank PER RESIDENT.
--
-- That ranking is not decoration: sorted by absolute commitments, Столична
-- община tops every column by construction, which tells a reader nothing and
-- buries the small municipalities the page exists to surface.
--
-- **Basis: NSI Census 2021's own per-MUNICIPALITY figure** (`data/census_2021.json`
-- → `municipalities[]`), 265 rows, one per община — not a roll-up over
-- settlements, so there is nothing to get wrong about Sofia. Note this is a
-- DIFFERENT number from the one the funds pipeline stores in
-- `fund_payloads(kind='muni-summary').payload->>'population'`: that one is a
-- settlement-level sum whose Sofia entry is EKATTE 68134, the CITY CORE
-- (1,183,400), while Столична община as a fiscal entity is 1,274,290. The
-- fiscal figures here are the município's, so the município's population is the
-- only denominator that divides like with like. Do not "reconcile" the two.
--
-- The census keys Sofia `SOF46`, which is `place_dim.price_code`; the other 264
-- codes match `place_dim.code` directly. The loader resolves that alias, so
-- what is STORED here is already the obshtina code `municipal_fiscal` uses.
CREATE TABLE IF NOT EXISTS obshtina_population (
  obshtina    text PRIMARY KEY,
  population  int  NOT NULL CHECK (population > 0),
  census_year int  NOT NULL
);

-- DECLARED BEFORE the two functions that read it, and that is load-bearing
-- rather than tidy. A `LANGUAGE sql` body is validated at CREATE time, so a
-- CREATE FUNCTION naming a table that does not exist yet raises 42P01 — and
-- because exec() sends this file as ONE transaction, the whole migration rolls
-- back: no table, no functions, no grants. It applies clean on any machine that
-- already has the table, which is why this ordering can only fail somewhere
-- else (a cold `db:refresh`, or the warm Cloud SQL this loader publishes to).

CREATE OR REPLACE FUNCTION municipal_fiscal_by_obshtina(
  p_obshtina text,
  p_year     int DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  -- Prefer the newest row that actually HAS the headline figure. The plain
  -- newest is 2025-Q3, where the ingest suppressed commitments for all 265
  -- municipalities (a frozen column carried forward), so a default call would
  -- return null for the one number this whole pillar exists to publish — and a
  -- null reads as „nothing contracted", not as „withheld". Falls back to the
  -- newest row of any kind so a município with nothing but suppressed quarters
  -- still resolves rather than vanishing.
  WITH scoped AS (
    SELECT mf.* FROM municipal_fiscal mf
    WHERE mf.obshtina = p_obshtina
      AND (p_year IS NULL OR mf.fiscal_year = p_year)
  ), pick AS (
    SELECT * FROM (
      SELECT *, 1 AS tier FROM scoped WHERE commitments_eur IS NOT NULL
      UNION ALL
      SELECT *, 2 AS tier FROM scoped
    ) t
    ORDER BY tier, fiscal_year DESC, quarter DESC
    LIMIT 1
  )
  SELECT to_jsonb(row) FROM (
    SELECT
      p.obshtina, p.mf_code, p.fiscal_year, p.quarter,
      COALESCE(pd.name_bg, p.name_bg) AS name_bg,
      pd.name_en,
      pd.oblast_code,
      p.currency,
      p.commitments_eur, p.expense_obligations_eur, p.arrears_eur,
      p.revenue_eur, p.expenditure_eur, p.budget_balance_eur,
      p.cash_on_hand_eur, p.debt_stock_eur,
      p.expenditure_avg4y_eur,
      p.arrears_pct, p.obligations_pct, p.commitments_pct,
      p.arrears_basis, p.obligations_basis, p.commitments_basis,
      p.collection_dni_pct, p.collection_dprs_pct, p.collection_avg_pct,
      p.criteria_met, p.criteria_evaluable, p.meets_threshold,
      p.in_recovery_procedure,
      -- Named so the UI can say WHY a figure is missing rather than showing a
      -- blank that reads as zero.
      p.suppressed_fields,
      -- The per-resident comparison, computed HERE so the município tile needs
      -- one small request rather than the whole 265-row ranking.
      --
      -- The peer set is the picked row's OWN year-end, not the corpus: ranking
      -- a 2024 figure against a 2025 cohort would move a município's rank
      -- whenever anyone else filed. Null-safe throughout — a município with a
      -- withheld commitments column gets a population and no rank, which is
      -- honest, rather than a rank of 265.
      op.population,
      p.commitments_eur / NULLIF(op.population, 0) AS commitments_per_capita_eur,
      -- The cohort is the picked row's OWN (year, QUARTER), not a fixed Q4.
      -- Pinning it to Q4 compared a 2025-Q2 figure against a 2025-Q4 cohort
      -- that does not exist yet: zero peers, so every município ranked „1 of
      -- 0" — the loudest possible way to render „unknown". Same-period is the
      -- rule the whole pillar rests on, and it applies to a rank as much as to
      -- a ratio.
      --
      -- CASE rather than a FILTER clause (FILTER is only valid on an aggregate
      -- CALL, and these are scalar subqueries), and it guards the COHORT as
      -- well as the município: a rank with nothing to rank against is null.
      CASE WHEN p.commitments_eur IS NOT NULL AND op.population > 0
            AND (SELECT count(*) FROM municipal_fiscal m2
                   JOIN obshtina_population o2 ON o2.obshtina = m2.obshtina
                  WHERE m2.quarter = p.quarter AND m2.fiscal_year = p.fiscal_year
                    AND m2.commitments_eur IS NOT NULL AND o2.population > 0) > 1
      THEN
        (SELECT count(*) + 1 FROM municipal_fiscal m2
           JOIN obshtina_population o2 ON o2.obshtina = m2.obshtina
          WHERE m2.quarter = p.quarter AND m2.fiscal_year = p.fiscal_year
            AND m2.commitments_eur IS NOT NULL AND o2.population > 0
            AND m2.commitments_eur / o2.population
                > p.commitments_eur / op.population)
      END AS per_capita_rank,
      (SELECT count(*) FROM municipal_fiscal m2
         JOIN obshtina_population o2 ON o2.obshtina = m2.obshtina
        WHERE m2.quarter = p.quarter AND m2.fiscal_year = p.fiscal_year
          AND m2.commitments_eur IS NOT NULL AND o2.population > 0)
        AS per_capita_ranked_count,
      -- MEDIAN, not mean: the distribution is long-tailed (the top município is
      -- ~30× the middle one), so a mean would sit above almost every município
      -- and „above average" would be the normal case.
      (SELECT percentile_cont(0.5) WITHIN GROUP (
                ORDER BY m2.commitments_eur / o2.population)
         FROM municipal_fiscal m2
         JOIN obshtina_population o2 ON o2.obshtina = m2.obshtina
        WHERE m2.quarter = p.quarter AND m2.fiscal_year = p.fiscal_year
          AND m2.commitments_eur IS NOT NULL AND o2.population > 0)
        AS per_capita_median_eur,
      -- The full quarterly series for this município, oldest first.
      -- snake_case throughout, matching the columns this payload is built from.
      -- An earlier draft had camelCase here and snake_case at the top level —
      -- one payload, two conventions, which a consumer resolves by guessing.
      (SELECT jsonb_agg(jsonb_build_object(
                'fiscal_year', s.fiscal_year, 'quarter', s.quarter,
                'commitments_eur', s.commitments_eur,
                'expense_obligations_eur', s.expense_obligations_eur,
                'arrears_eur', s.arrears_eur,
                'cash_on_hand_eur', s.cash_on_hand_eur,
                'suppressed_fields', s.suppressed_fields)
              ORDER BY s.fiscal_year, s.quarter)
       FROM municipal_fiscal s WHERE s.obshtina = p.obshtina) AS series
    FROM pick p
    LEFT JOIN place_dim pd
      ON pd.kind = 'obshtina' AND COALESCE(pd.governance_code, pd.code) = p.obshtina
    LEFT JOIN obshtina_population op ON op.obshtina = p.obshtina
  ) row;
$$;

-- DROP before CREATE, and the line is load-bearing: this function grew
-- `criteria_met` / `criteria_evaluable` / `population` /
-- `commitments_per_capita_eur` OUT columns, and `CREATE OR REPLACE` cannot
-- change a function's OUT-parameter row type — it fails with 42P13 and, because
-- exec() sends this file as ONE transaction, takes the whole migration with it.
-- Safe here in a way it is not elsewhere (see the CASCADE note in CLAUDE.md):
-- nothing reads this function from a stored query, only `/api/db` ad hoc.
DROP FUNCTION IF EXISTS municipal_fiscal_ranking(int, int);
CREATE OR REPLACE FUNCTION municipal_fiscal_ranking(
  p_year  int DEFAULT NULL,
  p_limit int DEFAULT 300
) RETURNS TABLE (
  obshtina text, name_bg text, name_en text, oblast_code text,
  fiscal_year int, quarter smallint,
  commitments_eur double precision, commitments_pct double precision,
  expense_obligations_eur double precision, obligations_pct double precision,
  arrears_eur double precision, arrears_pct double precision,
  cash_on_hand_eur double precision, debt_stock_eur double precision,
  meets_threshold boolean, in_recovery_procedure boolean,
  -- ARRAYS, not counts — they say WHICH of the six чл. 130а criteria are met
  -- and which could be evaluated at all. „N от 6" is derivable from the
  -- lengths; the reverse is not, and the browse marks the individual criteria.
  criteria_met smallint[], criteria_evaluable smallint[],
  population int, commitments_per_capita_eur double precision,
  -- The чл. 130а т. 6 collection layer on the map. Wholly independent of the
  -- liability layers — it measures tax administration rather than project
  -- timing — which is what makes it worth a layer of its own rather than a
  -- column nobody reads.
  collection_avg_pct double precision,
  suppressed_fields text[]
) LANGUAGE sql STABLE AS $$
  -- Year-end only: the чл. 130а ratios are annual, and ranking an interim
  -- quarter against a year-end one compares two different denominators.
  SELECT mf.obshtina,
         COALESCE(pd.name_bg, mf.name_bg), pd.name_en, pd.oblast_code,
         mf.fiscal_year, mf.quarter,
         mf.commitments_eur, mf.commitments_pct,
         mf.expense_obligations_eur, mf.obligations_pct,
         mf.arrears_eur, mf.arrears_pct,
         mf.cash_on_hand_eur, mf.debt_stock_eur,
         mf.meets_threshold, mf.in_recovery_procedure,
         mf.criteria_met, mf.criteria_evaluable,
         op.population,
         -- LEFT JOIN, so a município with no census row yields NULL rather than
         -- a division error — and NULL sorts last under DESC NULLS LAST below,
         -- which is the honest place for "we cannot rank this one".
         mf.commitments_eur / NULLIF(op.population, 0),
         mf.collection_avg_pct,
         mf.suppressed_fields
  FROM municipal_fiscal mf
  LEFT JOIN place_dim pd
    ON pd.kind = 'obshtina' AND COALESCE(pd.governance_code, pd.code) = mf.obshtina
  LEFT JOIN obshtina_population op ON op.obshtina = mf.obshtina
  WHERE mf.quarter = 4
    AND mf.fiscal_year = COALESCE(
          p_year, (SELECT max(fiscal_year) FROM municipal_fiscal WHERE quarter = 4))
  -- PER RESIDENT is the default, and absolute is the trap: on absolute
  -- commitments Столична община is first every year by construction. The
  -- statutory ratio breaks the tie, so two municipalities with no census row
  -- still order sensibly rather than arbitrarily.
  ORDER BY (mf.commitments_eur / NULLIF(op.population, 0)) DESC NULLS LAST,
           mf.commitments_pct DESC NULLS LAST,
           mf.commitments_eur DESC NULLS LAST
  -- GREATEST/LEAST IGNORE NULLs, so a NULL p_limit silently clamped to 1 row.
  -- NULL means unbounded here, matching open_calls_list — a count path through
  -- the function must not saturate at its own ceiling.
  LIMIT CASE WHEN p_limit IS NULL THEN NULL
             ELSE LEAST(GREATEST(p_limit, 1), 1000) END;
$$;

CREATE OR REPLACE FUNCTION municipal_fiscal_national(
  p_year int DEFAULT NULL,
  p_quarter smallint DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH target AS (
    SELECT COALESCE(p_year, max(fiscal_year)) AS y FROM municipal_fiscal
  ), scope AS (
    SELECT mf.* FROM municipal_fiscal mf, target t
    WHERE mf.fiscal_year = t.y
      AND mf.quarter = COALESCE(
            p_quarter,
            (SELECT max(quarter) FROM municipal_fiscal m2
             WHERE m2.fiscal_year = t.y))
  )
  SELECT to_jsonb(row) FROM (
    SELECT
      (SELECT y FROM target) AS fiscal_year,
      (SELECT max(quarter) FROM scope) AS quarter,
      count(*) AS municipality_count,
      -- Each total is reported WITH the number of municipalities behind it. A
      -- sum over a column the ingest suppressed is not zero, it is unknown, and
      -- a bare total would publish the difference as a collapse.
      sum(commitments_eur)          AS commitments_eur,
      count(commitments_eur)        AS commitments_n,
      sum(expense_obligations_eur)  AS expense_obligations_eur,
      count(expense_obligations_eur) AS expense_obligations_n,
      sum(arrears_eur)              AS arrears_eur,
      count(arrears_eur)            AS arrears_n,
      sum(cash_on_hand_eur)         AS cash_on_hand_eur,
      count(cash_on_hand_eur)       AS cash_on_hand_n,
      sum(debt_stock_eur)           AS debt_stock_eur,
      count(debt_stock_eur)         AS debt_stock_n,
      count(*) FILTER (WHERE in_recovery_procedure) AS in_recovery_n,
      -- A boolean FILTER counts NULL as false, which would publish
      -- „0 municipalities meet the чл. 130а threshold" when the truth is
      -- „unknown for all 265" — and it would sit beside in_recovery_n: 17 in
      -- the same payload, composing into a quotable claim that is not true.
      -- The three counts are reported separately so a consumer cannot collapse
      -- them by accident.
      count(*) FILTER (WHERE meets_threshold IS TRUE)  AS meets_threshold_n,
      count(*) FILTER (WHERE meets_threshold IS FALSE) AS below_threshold_n,
      count(*) FILTER (WHERE meets_threshold IS NULL)  AS threshold_unknown_n,
      -- Every field withheld for AT LEAST ONE município in this period — the
      -- state a consumer must be able to distinguish from a genuine zero. It is
      -- deliberately "any", not "every": one withheld município already makes
      -- the national sum an undercount, and `<field>_n` beside each total says
      -- how many rows are actually behind it.
      (SELECT array_agg(DISTINCT f)
         FROM scope s2, unnest(COALESCE(s2.suppressed_fields, '{}')) f) AS suppressed_fields
    FROM scope
  ) row;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION municipal_fiscal_by_obshtina(text, int) TO app_readonly;
    GRANT SELECT ON obshtina_population TO app_readonly;
    GRANT EXECUTE ON FUNCTION municipal_fiscal_ranking(int, int) TO app_readonly;
    GRANT EXECUTE ON FUNCTION municipal_fiscal_national(int, smallint) TO app_readonly;
  END IF;
END $$;
