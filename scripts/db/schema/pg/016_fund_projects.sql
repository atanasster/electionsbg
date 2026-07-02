-- ИСУН EU-funds per-PROJECT table (data/funds/projects/by-contract → PG). The
-- project-grain companion to fund_beneficiaries (the per-EIK aggregate): powers a
-- funds BROWSE + the per-company funds drill-down via the server-side table
-- engine (functions/db_table.js), all DB-only.
--
-- 81,616 projects; contract_number is the ИСУН project key. Joins the entity
-- graph on beneficiary_eik = contracts.contractor_eik = tr_companies.uic.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS fund_projects (
  contract_number   text PRIMARY KEY,
  beneficiary_eik   text,
  beneficiary_name  text,
  program_code      text,
  program_name      text,
  title             text,
  total_eur         double precision,
  grant_eur         double precision,
  own_cofinance_eur double precision,
  paid_eur          double precision,
  duration_months   integer,
  status            text,
  org_type          text,
  location_raw      text,
  ekatte            text,
  oblast            text
);

CREATE INDEX IF NOT EXISTS idx_fund_projects_eik     ON fund_projects(beneficiary_eik);
CREATE INDEX IF NOT EXISTS idx_fund_projects_program ON fund_projects(program_code);
CREATE INDEX IF NOT EXISTS idx_fund_projects_status  ON fund_projects(status);
CREATE INDEX IF NOT EXISTS idx_fund_projects_oblast  ON fund_projects(oblast);
CREATE INDEX IF NOT EXISTS idx_fund_projects_bname   ON fund_projects USING gin (beneficiary_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_fund_projects_title   ON fund_projects USING gin (title gin_trgm_ops);
