-- 153 — the spending units: who the budget is appropriated to, what they were
-- appropriated, and what (rarely) they reported spending.
--
-- Plan: docs/plans/budget-hub-v1.md §6.1.
--
-- ── TWO APPLIERS, ONE FILLER, and the reason is a .gitignore line ──────────
--
-- `data/budget/reconciliation/` and `data/budget/ministries/` are GITIGNORED —
-- bulky regenerable shards, shipped to the bucket only. Measured: 0 tracked
-- files against 24 and 55 on disk. So the loader that FILLS these tables
-- (load_budget_pg.ts) reads inputs a fresh clone and CI do not have, which puts
-- it in REFRESH_EXCLUSIONS.
--
-- ⚠️ TODAY THAT IS THE ONLY APPLIER, and a `db:refresh` therefore leaves these
-- tables absent entirely. `budget_pg_roundtrip.data.test.ts` skips on that state
-- rather than erroring, which is what keeps the chain green meanwhile.
--
-- T4 closes it: migration 155's `LANGUAGE sql` bodies are validated at CREATE
-- time, so they would raise 42P01 against absent tables and roll back. So
-- load_budget_hub_pg.ts WILL apply 152 + 153 before 155 + 156, carrying no data.
--
-- The tables will then EXIST wherever the serving layer does, EMPTY where the
-- shards were never available. That is the 147_tender_search_text shape and it
-- is deliberate: an empty table an operator can fill beats a missing one that
-- 42P01s a page. Everything downstream must read "0 rows" as "not loaded here",
-- never as "the state appropriated nothing".
--
-- ── THE COVERAGE FACT THAT SHAPES `executed_eur` ──────────────────────────
--
-- Almost every row has planned_eur and NO executed_eur. Measured across the
-- nine years on disk: 8 of 48 spending units carry an executed figure in the
-- best year (FY2024) and ZERO do in six of the nine. That is not a load bug —
-- МФ's per-ministry "Отчет за изпълнението на програмния бюджет" reaches few
-- report layouts the parser handles yet. Any surface ranking on variance must
-- publish the coverage pair beside it (plan §2.3); a top-5 alone asserts it
-- ranks the government's ministries.

-- ── The spending units ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budget_admin_node (
  node_id   text PRIMARY KEY,          -- 'admin-ministerstvo-na-finansite'
  name_bg   text NOT NULL,
  name_en   text NOT NULL,
  -- EIK, where the unit is also a procurement buyer. This is what lets a
  -- ministry page show its contracts WITHOUT a name match — the repo's standing
  -- rule (feedback_name_match_not_identity). NULL where no EIK is known.
  eik       text
);

COMMENT ON TABLE budget_admin_node IS
  'ПЪРВОСТЕПЕННИ РАЗПОРЕДИТЕЛИ, not ministries. On FY2024, 28 of the 48 units in the '
  'corpus are not ministries — Администрация на президента, ДФ „Земеделие", ДАНС, КЕВР, '
  'КФН and other first-level spending units are all here. A caption saying „министерства" '
  'over a count of this table is wrong by more than half.';

CREATE INDEX IF NOT EXISTS idx_budget_admin_node_eik
  ON budget_admin_node (eik) WHERE eik IS NOT NULL;

-- ── The admin-grain facts ─────────────────────────────────────────────────
--
-- Keyed on (year, node, kind, dimension) because the source rows are
-- (nodeId × kind): one unit contributes a revenue row, an expenditure row and a
-- balance row. Counting rows and calling the result "ministries" over-states by
-- 1.8×–2.9× — the §2.1 error this corpus produces most readily.
CREATE TABLE IF NOT EXISTS budget_admin_fact (
  fiscal_year   int  NOT NULL,
  node_id       text NOT NULL REFERENCES budget_admin_node(node_id) ON DELETE CASCADE,
  kind          text NOT NULL,         -- revenue | expenditure | balance
  -- 'admin' on every row TODAY, and kept in the key anyway. The shards publish
  -- four dimensions (admin / functional / economic / program) and by-economic
  -- exists on disk unloaded; when it lands it shares this table and the column
  -- stops being constant. That is the opposite of budget_program_fact's `kind`,
  -- which is constant BY CONSTRUCTION — the shard has only one.
  dimension     text NOT NULL,
  planned_eur   double precision,
  planned_law_eur double precision,
  amended_eur   double precision,
  executed_eur  double precision,
  variance_eur  double precision,
  variance_pct  double precision,
  completeness  text NOT NULL,         -- exact | partial | missing
  amendment_trail jsonb,
  PRIMARY KEY (fiscal_year, node_id, kind, dimension)
);

COMMENT ON COLUMN budget_admin_fact.planned_eur IS
  'The appropriation on the SAME basis as executed_eur — the unit''s own Отчет '
  '„Закон" column where a report exists, the ЗДБ otherwise. Right for THIS year''s '
  'variance; see planned_law_eur before using it across years.';

COMMENT ON COLUMN budget_admin_fact.amended_eur IS
  'After any ЗИД. Distinct from planned_eur on purpose: „a ministry overspent its '
  'appropriation" and „parliament re-voted the appropriation" are different findings, and '
  'a single „отклонение" collapses them.';
COMMENT ON COLUMN budget_admin_fact.executed_eur IS
  'From the unit''s own annual Отчет. NULL on most rows — 8 of 48 units in the best year, '
  'none in six of nine. NULL means „no report parsed", never „spent nothing".';

CREATE INDEX IF NOT EXISTS idx_budget_admin_fact_year_kind
  ON budget_admin_fact (fiscal_year, kind);
-- Partial: the deviations page reads only the rows that HAVE an execution, and
-- that is a low-single-digit percentage of the table.
CREATE INDEX IF NOT EXISTS idx_budget_admin_fact_executed
  ON budget_admin_fact (fiscal_year, node_id) WHERE executed_eur IS NOT NULL;

-- ── The programme grain ───────────────────────────────────────────────────
--
-- TWO IDENTIFIERS, AND THEY ARE NOT THE SAME THING. `by-program.json` keys its
-- rows on a PROGRAMME slug (`prog-byudzhetna-programa-administratsiya-13`) and
-- publishes no owning unit — measured, 0 of 86 FY2024 programme ids appear in
-- budget_admin_node. So `program_code` is the shard's key and `node_id` is the
-- ПЪРВОСТЕПЕНЕН РАЗПОРЕДИТЕЛ that runs it, recovered by the loader from
-- data/budget/ministries/<admin>.json (`years[].programs[].nodeId`).
--
-- Writing the programme id into both columns — which the first cut did — makes
-- `node_id` mean one thing here and another in budget_admin_fact, degenerates
-- the PK to (fiscal_year, node_id, node_id), and leaves „which programmes does
-- Министерство на финансите run" unanswerable from Postgres. The natural repair
-- for that later is a NAME join, which this repo forbids.
--
-- The mapping is total and unambiguous: 727 of 727 rows resolve, across 124
-- programme ids, with ZERO owned by more than one admin node in a year or
-- across years.
--
-- `node_id` is nullable and carries NO foreign key, because the ministries tree
-- is GITIGNORED: on a machine without it the owner is genuinely unknown, and
-- NULL says that. An FK would instead make the whole programme grain
-- unloadable there.
--
-- NOTE the key has NO `kind`. Unlike by-admin, the programme shards carry ONE
-- kind (expenditure) in all nine years, so rows === distinct programmes there.
-- Copying the (nodeId × kind) model onto this table would add a constant column
-- and invite a needless DISTINCT downstream.
CREATE TABLE IF NOT EXISTS budget_program_fact (
  fiscal_year  int  NOT NULL,
  -- The programme, as keyed by the shard. This is the identity.
  program_code text NOT NULL,
  -- The spending unit that runs it. NULL when the ministries tree was absent.
  node_id      text,
  name_bg      text,
  name_en      text,
  planned_eur  double precision,
  amended_eur  double precision,
  executed_eur double precision,
  completeness text NOT NULL,
  PRIMARY KEY (fiscal_year, program_code)
);

COMMENT ON COLUMN budget_program_fact.node_id IS
  'The owning първостепенен разпоредител (budget_admin_node.node_id), recovered from '
  'data/budget/ministries/. NULL means the GITIGNORED ministries tree was absent when this '
  'row loaded — not that the programme has no owner.';

CREATE INDEX IF NOT EXISTS idx_budget_program_fact_node
  ON budget_program_fact (node_id, fiscal_year) WHERE node_id IS NOT NULL;

-- ── Personnel ─────────────────────────────────────────────────────────────
--
-- Three headcount bases and they are FAR apart: on FY2024 the national figures
-- are 145,802 budgeted positions / 132,392 filled / 98,975 NSI list-headcount —
-- a 47% spread. „How many public employees" has no single true answer here, so
-- each is a named column and no view may collapse them.
CREATE TABLE IF NOT EXISTS budget_personnel (
  fiscal_year        int  NOT NULL,
  -- NULL node_id = the national row (the annual Доклад aggregate); a non-null
  -- one is that unit's slice.
  node_id            text,
  positions_total    int,
  positions_filled   int,
  positions_vacant   int,
  nsi_headcount      int,
  payroll_eur        double precision,
  -- T9.8 — the detail the Доклад publishes and the loader was dropping.
  -- NATIONAL grain (node_id IS NULL):
  positions_central              int,
  positions_territorial          int,
  positions_municipal            int,
  positions_municipal_own_rev    int,
  positions_vacant_over_6m       int,
  structures_central             int,
  structures_territorial         int,
  -- UNIT grain (node_id IS NOT NULL), from each ministry's own programme-budget
  -- report rather than from the Доклад:
  headcount_executed             int,
  avg_cost_per_fte_eur           double precision
);

COMMENT ON COLUMN budget_personnel.positions_total IS
  'Budgeted POSITIONS (щатни бройки). A position is not a person: counting these as '
  'employees counts vacancies, and positions_vacant is published beside it.';
COMMENT ON COLUMN budget_personnel.nsi_headcount IS
  'NSI list-headcount — a different publisher and a NARROWER perimeter: it excludes МВР '
  'and МО. Never comparable to positions_total without saying so. NULL means NSI published '
  'no breakdown for that year, which is four of the nine on file (2017-2020): the shard '
  'renders that as an empty breakdown summed to 0, and a stored 0 would draw the series '
  'falling off a cliff beside 130k budgeted positions.';

-- A partial unique index rather than a PRIMARY KEY, because node_id is NULL on
-- the national row and NULLs are never equal in a unique constraint — so a PK
-- would silently permit two national rows per year.
CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_personnel_national
  ON budget_personnel (fiscal_year) WHERE node_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_personnel_node
  ON budget_personnel (fiscal_year, node_id) WHERE node_id IS NOT NULL;

-- ── Functional (COFOG) ────────────────────────────────────────────────────
--
-- A DIFFERENT CORPUS from everything above, and the most dangerous adjacency on
-- the hub. Source is Eurostat gov_10a_exp, sector S13 = GENERAL GOVERNMENT: the
-- state budget PLUS municipalities PLUS the social funds. It is NOT a breakdown
-- of budget_fiscal_year_figure's expenditure, which is the МФ КФП STATE budget.
-- Different perimeter, different publisher, and a different latest year.
CREATE TABLE IF NOT EXISTS budget_cofog (
  fiscal_year int  NOT NULL,
  cofog_code  text NOT NULL,           -- GF01..GF10, TOTAL
  -- NULL on every row today, and that is the source's doing: data/cofog.json
  -- carries codes and values and no labels at all. The division names live in
  -- the SPA's i18n, which is the right home for display text — these columns
  -- exist so a future labelled source has somewhere to land, not as a gap.
  name_bg     text,
  name_en     text,
  amount_eur  double precision,
  pct_of_total double precision,
  PRIMARY KEY (fiscal_year, cofog_code)
);

COMMENT ON TABLE budget_cofog IS
  'Eurostat gov_10a_exp, sector S13 — GENERAL GOVERNMENT. NOT a decomposition of the КФП '
  'state-budget expenditure it will be rendered beside: a caption calling this „where the '
  'budget goes" silently swaps one aggregate for the other.';

-- ── The legislative path ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budget_document (
  document_id    text PRIMARY KEY,
  fiscal_year    int,                  -- NULL for the standing kfp-feed record
  kind           text NOT NULL,
  title_bg       text NOT NULL,
  title_en       text,
  published_on   date,
  dv_issue       text,
  url            text,
  -- Which of the OGP/IBP eight key budget documents this record is, or NULL
  -- when it maps to none. The frame is what lets /budget/law say „публикуваме N
  -- от 8" rather than listing 48 records.
  obs_category   text,
  -- The roll-call item that adopted it — vote_item(item_id), migration 134.
  -- NULL when unresolved, and NULL is the ONLY honest value for that: a title
  -- regex cannot tell a second-reading adoption from a procedural mention, and
  -- `bill`'s stem split is TypeScript for exactly this reason.
  adopted_by_item_id bigint
);

COMMENT ON COLUMN budget_document.adopted_by_item_id IS
  'Never inferred from a title match. Any aggregate over the vote it names must filter '
  'vote_item.superseded_by IS NULL (or over-count by 9.8%) and read party affiliation from '
  'vote_cast.party_id, the affiliation AT CAST TIME.';

CREATE INDEX IF NOT EXISTS idx_budget_document_year
  ON budget_document (fiscal_year, kind);

-- ── RECONCILE for warm databases (see 152's note) ─────────────────────────
ALTER TABLE budget_admin_node
  ADD COLUMN IF NOT EXISTS eik text;

ALTER TABLE budget_admin_fact
  ADD COLUMN IF NOT EXISTS planned_eur     double precision,
  ADD COLUMN IF NOT EXISTS planned_law_eur double precision,
  ADD COLUMN IF NOT EXISTS amended_eur     double precision,
  ADD COLUMN IF NOT EXISTS executed_eur    double precision,
  ADD COLUMN IF NOT EXISTS variance_eur    double precision,
  ADD COLUMN IF NOT EXISTS variance_pct    double precision,
  ADD COLUMN IF NOT EXISTS amendment_trail jsonb;

-- ⚠️ This COMMENT lives BELOW its ALTER, not beside the CREATE TABLE, and the
-- order is load-bearing. `CREATE TABLE IF NOT EXISTS` is a no-op on a warm
-- database, so a COMMENT placed up there names a column that does not exist
-- yet — and because exec() sends the file as ONE transaction, the whole
-- migration aborts before the reconcile block below ever runs. Measured: 153
-- could not be applied to any database created before planned_law_eur was
-- added, which is every one except a fresh clone. Any future column added to
-- the reconcile block must have its COMMENT here too.
COMMENT ON COLUMN budget_admin_fact.planned_law_eur IS
  'The ЗДБ''s own section II figure, non-NULL ONLY where the Отчет restated the '
  'appropriation at a wider (usually consolidated) scope. Any CROSS-YEAR series or '
  'multi-year SUM must read coalesce(planned_law_eur, planned_eur): only отчет-years '
  'carry the wide scope, so planned_eur steps up in whichever years a report landed '
  'and the step reads as budget growth. Measured 2026-08-13, exactly one ministry-year '
  'diverges — МОСВ 2024, EUR 60,325,488 vs 104,230,071 (+72.8%). '
  'See scripts/budget/reconcile.ts and src/data/budget/ministrySeries.ts.';

ALTER TABLE budget_program_fact
  ADD COLUMN IF NOT EXISTS node_id      text,
  ADD COLUMN IF NOT EXISTS name_bg      text,
  ADD COLUMN IF NOT EXISTS name_en      text,
  ADD COLUMN IF NOT EXISTS planned_eur  double precision,
  ADD COLUMN IF NOT EXISTS amended_eur  double precision,
  ADD COLUMN IF NOT EXISTS executed_eur double precision;

ALTER TABLE budget_personnel
  ADD COLUMN IF NOT EXISTS positions_total  int,
  ADD COLUMN IF NOT EXISTS positions_filled int,
  ADD COLUMN IF NOT EXISTS positions_vacant int,
  ADD COLUMN IF NOT EXISTS nsi_headcount    int,
  ADD COLUMN IF NOT EXISTS payroll_eur      double precision;

ALTER TABLE budget_cofog
  ADD COLUMN IF NOT EXISTS name_bg      text,
  ADD COLUMN IF NOT EXISTS name_en      text,
  ADD COLUMN IF NOT EXISTS pct_of_total double precision;

ALTER TABLE budget_document
  ADD COLUMN IF NOT EXISTS title_en           text,
  ADD COLUMN IF NOT EXISTS published_on       date,
  ADD COLUMN IF NOT EXISTS dv_issue           text,
  ADD COLUMN IF NOT EXISTS url                text,
  ADD COLUMN IF NOT EXISTS obs_category       text,
  ADD COLUMN IF NOT EXISTS adopted_by_item_id bigint;

-- T9.8. `CREATE TABLE IF NOT EXISTS` is a no-op on a warm database, so the
-- columns above reach a fresh clone and nothing else. Every column is written
-- twice in this file on purpose; tr_search_shape.test.ts documents the same
-- rule for 003.
ALTER TABLE budget_personnel
  ADD COLUMN IF NOT EXISTS positions_central           int,
  ADD COLUMN IF NOT EXISTS positions_territorial       int,
  ADD COLUMN IF NOT EXISTS positions_municipal         int,
  ADD COLUMN IF NOT EXISTS positions_municipal_own_rev int,
  ADD COLUMN IF NOT EXISTS positions_vacant_over_6m    int,
  ADD COLUMN IF NOT EXISTS structures_central          int,
  ADD COLUMN IF NOT EXISTS structures_territorial      int,
  ADD COLUMN IF NOT EXISTS headcount_executed          int,
  ADD COLUMN IF NOT EXISTS avg_cost_per_fte_eur        double precision;

-- COMMENTS BELOW THE ALTER, never above it. `exec()` sends this file as ONE
-- transaction, so a COMMENT on a column that does not exist yet aborts the
-- whole migration on every warm database — measured on this very file in T1.
COMMENT ON COLUMN budget_personnel.positions_central IS
  'Щатни бройки in CENTRAL administration. central + territorial = total; `municipal` is '
  'a SUBSET of territorial, not a third peer, so the three never sum to the total.';
COMMENT ON COLUMN budget_personnel.positions_municipal_own_rev IS
  'The slice of municipal positions funded from the municipality own revenue rather than '
  'from the state transfer. A SUBSET of positions_municipal.';
COMMENT ON COLUMN budget_personnel.positions_vacant_over_6m IS
  'Vacancies open longer than six months — a SUBSET of positions_vacant, never a peer of '
  'it. 5 729 of 12 348 in FY2025.';
COMMENT ON COLUMN budget_personnel.structures_central IS
  'COUNT OF ADMINISTRATIVE BODIES, not of people. 114 central + 467 territorial = 581 in '
  'FY2025. Rendered beside headcounts, an unlabelled 581 reads as a headcount.';
COMMENT ON COLUMN budget_personnel.headcount_executed IS
  'UNIT grain only (node_id IS NOT NULL): executed FTE from that ministry own '
  'programme-budget report — a DIFFERENT publisher from the Доклад the national row comes '
  'from. Never summed with, or compared against, positions_total.';
COMMENT ON COLUMN budget_personnel.avg_cost_per_fte_eur IS
  'The SOURCE report own average annual cost per FTE, not payroll_eur / headcount_executed. '
  'They agree to the euro today; storing the published figure keeps one producer.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_admin_fact_completeness') THEN
    ALTER TABLE budget_admin_fact
      ADD CONSTRAINT budget_admin_fact_completeness
      CHECK (completeness IN ('exact', 'partial', 'missing'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_admin_fact_kind') THEN
    ALTER TABLE budget_admin_fact
      ADD CONSTRAINT budget_admin_fact_kind
      CHECK (kind IN ('revenue', 'expenditure', 'balance'));
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON budget_admin_node   TO app_readonly;
    GRANT SELECT ON budget_admin_fact   TO app_readonly;
    GRANT SELECT ON budget_program_fact TO app_readonly;
    GRANT SELECT ON budget_personnel    TO app_readonly;
    GRANT SELECT ON budget_cofog        TO app_readonly;
    GRANT SELECT ON budget_document     TO app_readonly;
  END IF;
END $$;
