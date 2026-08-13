-- 154 — the municipal corpus: WHAT THE STATE SENDS.
--
-- Plan: docs/plans/budget-hub-v1.md §6.1 and §8. Applied and filled by
-- scripts/db/load_budget_muni_pg.ts, which — unlike db:load:budget:pg — is IN
-- the db:refresh chain, because every one of its inputs is COMMITTED
-- (municipal_transfers 47/47 tracked, capital_programs 112/112, ipop 265/265,
-- municipal_execution 17/17).
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE BOUNDARY, WHICH IS THE MOST IMPORTANT THING IN THIS FILE
-- ══════════════════════════════════════════════════════════════════════════
--
-- There are now TWO municipal money corpora in this database and they must
-- NEVER be summed, netted, or shown as one „municipal money" figure:
--
--   THIS FILE          what the state SENDS      Art. 53 transfers, capital
--                                                programmes, ИПОП. Annual.
--                                                Home: /budget/municipal*
--
--   migration 149      what municipalities OWE   ЗПФ чл. 130а — commitments,
--   (municipal_fiscal)                           expense obligations, arrears.
--                                                Quarterly.
--                                                Home: /governance/municipal-finance
--
-- A transfer received and a liability contracted are different facts, about
-- different years, with different debtors. `municipal-fiscal-commitments-v1`
-- T11.2 draws the same line one level up (state debt vs municipal commitments:
-- „adjacent and never combined"); this is that rule applied to the tier below.
-- No view here joins municipal_fiscal, and no aggregate here may reach one.
--
-- ── Sofia, and why the key is `obshtina` ──────────────────────────────────
--
-- `obshtina` joins `place_dim` (117) for every label — the same dictionary
-- /procurement and /person use. Note this corpus keys Sofia as SOF46 / its own
-- obshtina code, NOT as 149's synthetic `SOF00`: the two corpora came from
-- different publishers and only 149's needed a synthetic row. Any surface
-- showing both must not assume one key works for the other.
--
-- ── Money ─────────────────────────────────────────────────────────────────
--
-- Every column is EUR and `double precision`. The shards carry {amount,
-- amountEur, currency} and only the euro half is stored, with the source
-- denomination beside it as provenance — pre-2026 sources are BGN. `numeric`
-- is deliberately not used: node-postgres serialises it as a STRING, which
-- blanks every money cell on the page while the number is present in the
-- payload (migrations 120 and 142 both learned this).

-- ── Art. 53: the transfer envelope ────────────────────────────────────────
--
-- Complete by construction: the State Budget Law names all 265 municipalities,
-- so this table is the one municipal surface with no coverage caveat.
CREATE TABLE IF NOT EXISTS budget_muni_transfer (
  obshtina            text NOT NULL,
  fiscal_year         int  NOT NULL,
  ekatte              text,
  name_bg             text,
  -- The five published transfer kinds plus their total. `total` is the LAW's
  -- own total, not the sum of the five — stored rather than derived so a
  -- reader can see if they ever disagree.
  delegated_eur       double precision,
  equalization_eur    double precision,
  capital_eur         double precision,
  winter_eur          double precision,
  other_targeted_eur  double precision,
  total_eur           double precision,
  source_denomination text,
  PRIMARY KEY (obshtina, fiscal_year)
);

COMMENT ON TABLE budget_muni_transfer IS
  'ЗДБРБ чл. 53 — the transfer envelope the state sends each municipality. NOT what the '
  'municipality owes: that is municipal_fiscal (149), a different corpus that must never '
  'be summed with this one.';
COMMENT ON COLUMN budget_muni_transfer.total_eur IS
  'The law''s published total, stored rather than summed from the five kinds so a '
  'disagreement between them is visible instead of hidden.';

CREATE INDEX IF NOT EXISTS idx_budget_muni_transfer_year
  ON budget_muni_transfer (fiscal_year);

-- ── ИПОП: the МРРБ municipal investment programme ─────────────────────────
--
-- 3,492 projects across 264 municipalities. `stalled` is the field that makes
-- this worth opening — 769 of them — and it is PUBLISHED by МРРБ, never derived
-- here from a paid share.
CREATE TABLE IF NOT EXISTS budget_muni_ipop_project (
  project_id     text NOT NULL,
  fiscal_year    int  NOT NULL,
  obshtina       text NOT NULL,
  description    text,
  agreement_eur  double precision,
  submitted_eur  double precision,
  awaiting_eur   double precision,
  paid_eur       double precision,
  mrrb_paid_eur  double precision,
  bbr_paid_eur   double precision,
  paid_pct       double precision,
  stalled        boolean NOT NULL DEFAULT false,
  PRIMARY KEY (project_id, fiscal_year)
);

COMMENT ON COLUMN budget_muni_ipop_project.stalled IS
  'МРРБ''s own published flag, never derived from paid_pct here. A derived one would '
  'relabel a project that is merely early as stopped.';
COMMENT ON COLUMN budget_muni_ipop_project.paid_eur IS
  'Total paid. mrrb_paid_eur + bbr_paid_eur are its two channels and are stored '
  'separately because they are different payers, not a breakdown to be re-added.';

CREATE INDEX IF NOT EXISTS idx_budget_muni_ipop_place
  ON budget_muni_ipop_project (obshtina, fiscal_year);

-- ── Per-município capital programmes ──────────────────────────────────────
--
-- 26 of 265, and the 26 are NOT a clean administrative tier. An earlier draft
-- of this header called them „oblast centres" and instructed every surface to
-- say so; measured against place_dim, six of the 26 are not oblast centres at
-- all (Асеновград, Велинград, Дупница, Казанлък, Карлово, Самоков) and seven
-- oblast centres are absent. They are simply the municipalities whose capital
-- programme was reachable and parseable.
--
-- So a caption over this table names the COUNT and not a category: „26 общини",
-- never „26 областни центъра" and never a bare figure that reads as national.
CREATE TABLE IF NOT EXISTS budget_muni_capital_project (
  obshtina             text NOT NULL,
  fiscal_year          int  NOT NULL,
  project_ord          int  NOT NULL,
  name_bg              text,
  settlement           text,
  -- The funding mix as published. Kept apart rather than summed: „paid for by
  -- the state" and „paid for by a loan" are the question this table answers.
  state_subsidy_eur    double precision,
  own_funds_eur        double precision,
  debt_eur             double precision,
  eu_funds_eur         double precision,
  other_eur            double precision,
  -- NULL when the source published neither carry-over field. A 0 here would be
  -- a claim that nothing was carried over, which is true of 291 projects and
  -- unknown for 13,537 of them.
  carry_over_eur       double precision,
  total_eur            double precision,
  source_denomination  text,
  PRIMARY KEY (obshtina, fiscal_year, project_ord)
);

COMMENT ON TABLE budget_muni_capital_project IS
  'Per-município capital programmes for 26 of 265 municipalities. NOT „oblast centres": six '
  'of the 26 are not, and seven centres are missing. A count over this table is not a '
  'national figure and must not be captioned as a category either.';

-- ── Per-município budget execution ────────────────────────────────────────
--
-- TWO municipalities (Ruse and Nikolaevo). A pilot, not a surface: the hub
-- deliberately gives it no tile (plan §8.2), because a national municipal-
-- execution view implied by 2 of 265 is the worst version of the
-- „destination counts a different set" defect.
CREATE TABLE IF NOT EXISTS budget_muni_execution (
  obshtina            text NOT NULL,
  fiscal_year         int  NOT NULL,
  kind                text NOT NULL,   -- revenue | expense
  line_code           text NOT NULL,
  name_bg             text,
  planned_eur         double precision,
  executed_eur        double precision,
  source_denomination text,
  PRIMARY KEY (obshtina, fiscal_year, kind, line_code)
);

COMMENT ON TABLE budget_muni_execution IS
  'Per-município execution for the TWO municipalities whose open data publishes it '
  '(Ruse, Nikolaevo). 2 of 265 — a pilot. Any count over it is about those two.';

-- ── RECONCILE for warm databases ──────────────────────────────────────────
--
-- `CREATE TABLE IF NOT EXISTS` is a no-op once the table exists, so every
-- nullable column above is repeated here or a new one reaches a fresh clone and
-- nothing else (003's lesson). A TYPE change still needs a hand-written ALTER.
ALTER TABLE budget_muni_transfer
  ADD COLUMN IF NOT EXISTS ekatte              text,
  ADD COLUMN IF NOT EXISTS name_bg             text,
  ADD COLUMN IF NOT EXISTS delegated_eur       double precision,
  ADD COLUMN IF NOT EXISTS equalization_eur    double precision,
  ADD COLUMN IF NOT EXISTS capital_eur         double precision,
  ADD COLUMN IF NOT EXISTS winter_eur          double precision,
  ADD COLUMN IF NOT EXISTS other_targeted_eur  double precision,
  ADD COLUMN IF NOT EXISTS total_eur           double precision,
  ADD COLUMN IF NOT EXISTS source_denomination text;

ALTER TABLE budget_muni_ipop_project
  ADD COLUMN IF NOT EXISTS stalled       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS description   text,
  ADD COLUMN IF NOT EXISTS agreement_eur double precision,
  ADD COLUMN IF NOT EXISTS submitted_eur double precision,
  ADD COLUMN IF NOT EXISTS awaiting_eur  double precision,
  ADD COLUMN IF NOT EXISTS paid_eur      double precision,
  ADD COLUMN IF NOT EXISTS mrrb_paid_eur double precision,
  ADD COLUMN IF NOT EXISTS bbr_paid_eur  double precision,
  ADD COLUMN IF NOT EXISTS paid_pct      double precision;

ALTER TABLE budget_muni_capital_project
  ADD COLUMN IF NOT EXISTS name_bg             text,
  ADD COLUMN IF NOT EXISTS settlement          text,
  ADD COLUMN IF NOT EXISTS state_subsidy_eur   double precision,
  ADD COLUMN IF NOT EXISTS own_funds_eur       double precision,
  ADD COLUMN IF NOT EXISTS debt_eur            double precision,
  ADD COLUMN IF NOT EXISTS eu_funds_eur        double precision,
  ADD COLUMN IF NOT EXISTS other_eur           double precision,
  ADD COLUMN IF NOT EXISTS carry_over_eur      double precision,
  ADD COLUMN IF NOT EXISTS total_eur           double precision,
  ADD COLUMN IF NOT EXISTS source_denomination text;

ALTER TABLE budget_muni_execution
  ADD COLUMN IF NOT EXISTS name_bg             text,
  ADD COLUMN IF NOT EXISTS planned_eur         double precision,
  ADD COLUMN IF NOT EXISTS executed_eur        double precision,
  ADD COLUMN IF NOT EXISTS source_denomination text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_muni_execution_kind') THEN
    ALTER TABLE budget_muni_execution
      ADD CONSTRAINT budget_muni_execution_kind
      CHECK (kind IN ('revenue', 'expense'));
  END IF;
END $$;

-- Role-guarded: `roles_readonly.sql` is a cluster-wide, hand-run step on Cloud
-- SQL, so app_readonly may not exist on the target. An unguarded GRANT raises
-- 42704 and — exec() sending a migration as ONE transaction — rolls this whole
-- file back, leaving no tables at all on a cold bootstrap.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON budget_muni_transfer         TO app_readonly;
    GRANT SELECT ON budget_muni_ipop_project     TO app_readonly;
    GRANT SELECT ON budget_muni_capital_project  TO app_readonly;
    GRANT SELECT ON budget_muni_execution        TO app_readonly;
  END IF;
END $$;
