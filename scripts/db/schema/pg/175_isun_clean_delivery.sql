-- 175 — ИСУН „clean delivery". Plan P9, re-scoped after the probe.
--
-- What ИСУН publishes about EU-funded contracts that ended without a financial
-- correction. Two reports, two different populations, never to be summed:
--   • isun_clean_contract     — completed projects with NO imposed correction
--   • isun_clean_beneficiary  — beneficiaries with no correction, and their count
--                               of contracts completed ON TIME
--
-- ⚠️⚠️ THIS IS AN ACHIEVEMENT REGISTER, NOT THE COMPLEMENT OF „WAS CORRECTED".
-- P9 originally asked which contracts were clawed back. That is NOT derivable
-- here and must never be inferred by subtracting these tables from fund_projects:
-- a project can be absent because it finished LATE, was terminated (3,656 rows in
-- our corpus are `Прекратен`), or is still in final verification. Individual
-- irregularity records go to OLAF's IMS, which is confidential — there is no
-- public complement anywhere. Subtracting would manufacture accusations against
-- named beneficiaries out of ordinary lateness, in the one direction that cannot
-- be walked back. `isun_clean_delivery_coverage.absence_meaning` carries that
-- sentence so no serving surface has to remember it.
--
-- ⚠️ THE JOIN KEY IS `contract_number`, NOT `reg_no`. ИСУН's registration number
-- carries a `-C##` contract-VERSION suffix („…-0001-C01") that
-- `fund_projects.contract_number` does not. Measured: joining on the raw value
-- matches 0 of 9,940 rows; on the stripped base, 9,940 of 9,940.
--
-- ⚠️ ORGANISATIONS ONLY. 1,533 beneficiary rows are natural persons published with
-- a first name and no id („Христо", org type „Друга"), and 2 carry a 10-digit ЕГН.
-- Neither is stored: a first name identifies nobody and joins to nothing, and an
-- ЕГН is a personal identifier this project does not hold. Both are counted in
-- coverage.natural_persons_excluded so the omission is visible rather than silent.

CREATE TABLE IF NOT EXISTS isun_clean_contract (
  reg_no            text PRIMARY KEY,
  contract_number   text NOT NULL,           -- the -C## suffix stripped: the JOIN key
  programme         text,
  procedure         text,
  title             text,
  beneficiary_eik   text,
  beneficiary_name  text,
  org_type          text,
  org_kind          text,
  enterprise_category text,
  duration_months   integer,
  signed_on         date,
  original_end_on   date,
  closed_on         date,
  status            text
);

COMMENT ON COLUMN isun_clean_contract.contract_number IS
  'reg_no with the -C## contract-version suffix stripped. This is what joins '
  'fund_projects.contract_number — the raw reg_no matches 0 of 9,940 rows.';

CREATE INDEX IF NOT EXISTS idx_icc_contract_number ON isun_clean_contract (contract_number);
CREATE INDEX IF NOT EXISTS idx_icc_eik ON isun_clean_contract (beneficiary_eik);

CREATE TABLE IF NOT EXISTS isun_clean_beneficiary (
  eik               text PRIMARY KEY,
  name              text NOT NULL,
  org_type          text,
  org_kind          text,
  seat              text,
  -- „Брой договори, успешно приключени В СРОК" — on time, a STRICTER test than
  -- „no correction". This is why the two tables do not reconcile and must not be
  -- made to: 9,940 clean contracts against 41,530 on-time ones.
  on_time_contracts integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS isun_clean_delivery_coverage (
  id                        integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  built_at                  timestamptz NOT NULL,
  contract_criterion        text NOT NULL,
  beneficiary_criterion     text NOT NULL,
  -- NOT NULL on purpose: a consumer that reads this table can always state what
  -- absence means, because a row without the sentence cannot exist.
  absence_meaning           text NOT NULL,
  contracts                 integer NOT NULL,
  beneficiaries             integer NOT NULL,
  natural_persons_excluded  integer NOT NULL,
  on_time_contracts_declared integer NOT NULL,
  programmes                jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- The one supported per-company read. Returns the clean-delivery record beside the
-- caveat, so a page cannot render the number without the sentence that bounds it.
CREATE OR REPLACE FUNCTION isun_clean_delivery_for_eik(p_eik text)
RETURNS TABLE (
  eik text, name text, on_time_contracts integer,
  clean_contracts bigint, programmes jsonb, absence_meaning text
)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT b.eik, b.name, b.on_time_contracts,
         (SELECT count(*) FROM isun_clean_contract c WHERE c.beneficiary_eik = p_eik),
         (SELECT coalesce(jsonb_agg(DISTINCT c.programme), '[]'::jsonb)
            FROM isun_clean_contract c WHERE c.beneficiary_eik = p_eik),
         (SELECT absence_meaning FROM isun_clean_delivery_coverage WHERE id = 1)
    FROM isun_clean_beneficiary b
   WHERE b.eik = p_eik;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON isun_clean_contract, isun_clean_beneficiary,
                    isun_clean_delivery_coverage TO app_readonly;
    GRANT EXECUTE ON FUNCTION isun_clean_delivery_for_eik(text) TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly absent — 175 granted nothing. Run db:pg:bootstrap.';
  END IF;
END $$;
