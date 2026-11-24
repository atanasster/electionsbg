-- 208 — named projects in the State Budget Law: „Приложение № 2 към чл. 110" —
-- the programme of priority strategic investment projects with national financing
-- (раздел I, ал. 1) and, where the law has one, the list of RESERVE projects
-- (раздел II, ал. 2). docs/plans/insait-gap-v1.md §4. Loaded by
-- `db:load:budget-named:pg` from the cached Държавен вестник law HTML
-- (raw_data/budget/law-<idMat>.html.gz, gitignored, written by the budget ingest).
--
-- ⚠️ THREE KINDS OF AMOUNT, and only one is an appropriation:
--   appropriation — the capital spending the law sets for that year (раздел I);
--   forecast      — „прогнозен размер" for a later year (раздел I, from the 2026 law);
--   indicative    — a reserve project's amount (раздел II), funded only if money frees up.
-- Never sum across kinds, and never present a forecast or a reserve as money granted.
--
-- ⚠️ APPROPRIATED ≠ TRANSFERRED ≠ SPENT. Nothing here says the money moved; a surface
-- that has no transfer or execution figure says „няма данни", never 0.
--
-- Project codes (NP-25.001-0048) are the law's own; the same project is re-coded from
-- one law to the next (NP-25.002-0048 in 2026), so a link to an entity is an explicit
-- list of codes, never a name search.

CREATE TABLE IF NOT EXISTS budget_named_appropriation (
  fiscal_year   integer NOT NULL,                -- the law's year
  section       text    NOT NULL CHECK (section IN ('priority', 'reserve')),
  seq           integer NOT NULL,                -- the row's № within its section
  project_code  text    NOT NULL,
  title         text    NOT NULL,
  indicator     text,
  institution   text    NOT NULL,                -- „Отговорна институция"
  currency      text    NOT NULL CHECK (currency IN ('BGN', 'EUR')), -- the law's unit
  dv_idmat      text    NOT NULL,                -- dv.parliament.bg material id
  PRIMARY KEY (fiscal_year, section, seq)
);

CREATE TABLE IF NOT EXISTS budget_named_appropriation_amount (
  fiscal_year   integer NOT NULL,
  section       text    NOT NULL,
  seq           integer NOT NULL,
  year          integer NOT NULL,
  kind          text    NOT NULL CHECK (kind IN ('appropriation', 'forecast', 'indicative')),
  amount_native double precision NOT NULL,       -- thousands of `currency`, as printed
  amount_eur    double precision NOT NULL,       -- EUR (лв at the locked 1.95583)
  PRIMARY KEY (fiscal_year, section, seq, year),
  FOREIGN KEY (fiscal_year, section, seq)
    REFERENCES budget_named_appropriation (fiscal_year, section, seq) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_budget_named_appropriation_code
  ON budget_named_appropriation (project_code);

COMMENT ON TABLE budget_named_appropriation IS
  'State Budget Law Приложение № 2 към чл. 110 — named investment projects. Only kind '
  '= appropriation is money the law set; forecast and indicative (reserve) are not. See 208.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON budget_named_appropriation, budget_named_appropriation_amount
      TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly absent — 208 granted nothing';
  END IF;
END $$;
