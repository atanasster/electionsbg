-- ИСУН EU-funds SERVING layer — makes every /funds page DB-backed so the bulky
-- data/funds/ JSON tree can be retired from the GCS bucket + git (mirrors the
-- procurement PG migration). This is a SERVING migration, not an ingest rewrite:
-- the /update-funds ingest keeps writing the on-disk JSON, which stays the PG
-- load source (see [[feedback_no_json_from_pg]] — JSON → PG, never PG → JSON).
--
-- Two serving shapes:
--
--  1. fund_payloads — a generic (kind, key) → jsonb blob table holding every
--     PRECOMPUTED funds page payload verbatim (corpus index, projects index,
--     muni-map, taxonomy/absorption/sankey, integrity + per-programme shards,
--     mp_connected + per-mp/by-eik shards, political_links + per-eik shards,
--     confirmed, themes + per-slug shards, per-place + per-programme summaries,
--     geo pins). The ingest already computes these against settlements.json /
--     census / the MP-companies graph; recomputing them in SQL would be a large,
--     fragile re-implementation with zero upside (they are static all-time reads,
--     no date-windowing). Storing them verbatim makes local↔cloud parity byte-
--     exact by construction (nothing is recomputed) and every fetch an O(1) PK
--     seek. ~4.6k small rows.
--
--  2. fund_projects (the per-project relational table, loaded from
--     projects/by-contract) gains the few columns the by-contract DETAIL payload
--     needs beyond the browse projection (org_kind/org_form/hq_address + the full
--     resolved `location` object), served via fund_contract_detail(). Kept
--     relational rather than blobbed to avoid duplicating ~180 MB of by-contract
--     JSON already stored as 81,616 typed rows.

-- 1. Generic precomputed-payload blob table -------------------------------------
CREATE TABLE IF NOT EXISTS fund_payloads (
  kind    text  NOT NULL,          -- payload family, e.g. 'index', 'program-summary'
  key     text  NOT NULL DEFAULT '', -- natural key ('' for singletons)
  payload jsonb NOT NULL,
  PRIMARY KEY (kind, key)
);

-- 2. Per-project DETAIL columns (populated by load_funds_pg from by-contract) ----
ALTER TABLE fund_projects ADD COLUMN IF NOT EXISTS org_kind      text;
ALTER TABLE fund_projects ADD COLUMN IF NOT EXISTS org_form      text;
ALTER TABLE fund_projects ADD COLUMN IF NOT EXISTS hq_address    text;
ALTER TABLE fund_projects ADD COLUMN IF NOT EXISTS location_json jsonb;

-- Optional per-beneficiary sub-unit list (~10 EIKs where a parent org + its
-- sub-units — райони / клонове / териториални поделения — share one EIK and are
-- aggregated into one row; the source file then carries a `subUnits` array).
ALTER TABLE fund_beneficiaries ADD COLUMN IF NOT EXISTS sub_units jsonb;

-- Single by-contract project → the FundsProjectsContractFile shape. All 18 top-
-- level keys are ALWAYS present in the source (beneficiaryEik may be null but the
-- KEY is kept), so we build every key unconditionally — NO jsonb_strip_nulls at
-- the top level. `location` is stored verbatim (location_json) so its optional
-- sub-fields (ekatte / munis / oblasts / nutsCodes / ambiguousCandidates) are
-- already omitted-when-absent exactly as the source writes them.
CREATE OR REPLACE FUNCTION fund_contract_detail(p_number text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'programCode',     program_code,
    'programName',     program_name,
    'beneficiaryEik',  beneficiary_eik,
    'beneficiaryName', beneficiary_name,
    'orgType',         org_type,
    'orgKind',         org_kind,
    'orgForm',         org_form,
    'hqAddress',       hq_address,
    'locationRaw',     location_raw,
    'contractNumber',  contract_number,
    'title',           title,
    'totalEur',        total_eur,
    'grantEur',        grant_eur,
    'ownCofinanceEur', own_cofinance_eur,
    'paidEur',         paid_eur,
    'durationMonths',  duration_months,
    'status',          status,
    'location',        location_json
  )
  FROM fund_projects WHERE contract_number = p_number;
$$;

-- Per-beneficiary rollup → the FundsBeneficiary shape (data/funds/
-- beneficiaries-by-eik/{eik}.json). fund_beneficiaries already carries exactly
-- these columns; all keys are always present in the source (values may be null).
CREATE OR REPLACE FUNCTION fund_beneficiary_detail(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'eik',           eik,
    'name',          name,
    'orgType',       org_type,
    'orgKind',       org_kind,
    'orgForm',       org_form,
    'contractCount', contract_count,
    'contractedEur', contracted_eur,
    'paidEur',       paid_eur
  )
  -- `subUnits` is present (last key) only for the handful of parent+sub-unit
  -- shared-EIK rows; omitted otherwise, exactly as the source file writes it.
  || CASE WHEN sub_units IS NOT NULL
          THEN jsonb_build_object('subUnits', sub_units)
          ELSE '{}'::jsonb END
  FROM fund_beneficiaries WHERE eik = p_eik;
$$;
