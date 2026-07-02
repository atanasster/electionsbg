-- ИСУН EU-funds beneficiaries (per-EIK aggregate) → PG, so the DB company page
-- can show an "EU grants" section entirely from Postgres (no JSON fetch).
--
-- This is the per-BENEFICIARY aggregate (data/funds/beneficiaries-by-eik/*.json:
-- contracted/paid/contractCount/orgType) — enough for the company section + the
-- unified entity graph (fund_beneficiaries.eik = contracts.contractor_eik =
-- tr_companies.uic). A full per-PROJECT fund_projects table (data/funds/projects,
-- ~849 MB) for a funds browse is the larger roadmap-#1 follow-on.

CREATE TABLE IF NOT EXISTS fund_beneficiaries (
  eik             text PRIMARY KEY,
  name            text,
  org_type        text,
  org_kind        text,
  org_form        text,
  contract_count  integer,
  contracted_eur  double precision,
  paid_eur        double precision
);
