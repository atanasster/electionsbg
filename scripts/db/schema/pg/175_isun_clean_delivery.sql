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
--
-- ⚠️ IT DRIVES FROM BOTH REGISTERS, NOT FROM THE BENEFICIARY TABLE. The two reports
-- are separate exports and their populations are not nested: measured 2026-09-02,
-- 956 EIKs appear in isun_clean_contract with NO isun_clean_beneficiary row —
-- 1,740 clean-contract rows, 17.5% of the register. Driving from the beneficiary
-- side returned NO ROW for all of them, so the page never mounted the tile and
-- ИСУН's own named, uncorrected projects were discarded at the query.
--
-- ⚠️ `on_time_contracts` IS NULL, NEVER 0, FOR A CONTRACT-ONLY COMPANY. „Not listed
-- as a correction-free beneficiary" and „listed with zero on-time contracts" are
-- different claims, and only the second is a number. `beneficiary_listed` carries
-- the distinction explicitly so a consumer cannot recover it from a coalesce.
--
-- ⚠️ THE TWO COUNTS MEASURE DIFFERENT THINGS AND MUST NOT BE SUBTRACTED.
-- `on_time_contracts` is the beneficiary report's „успешно приключени В СРОК";
-- `clean_contracts` is this EIK's row count in the „без наложени финансови
-- корекции" list. A contract can be on-time-but-corrected or late-but-clean, so
-- on_time − clean is NOT „contracts that were corrected" — for a company in the
-- beneficiary table it is 0 by construction, since presence there IS the claim
-- that no correction was imposed on it. `contracts` returns the named rows so a
-- surface can show the evidence instead of leaving a reader to do that arithmetic.
--
-- The DROP is required, not defensive: `CREATE OR REPLACE` cannot alter a
-- function's OUT-parameter row type, and this signature gained
-- `beneficiary_listed` + `contracts`. It is a PLAIN drop (never CASCADE) and the
-- function has no stored-query dependents today — the two readers are ad-hoc
-- queries in `functions/db_routes.js` and the data gate — so if one is ever added,
-- POSTGRES refuses this with 2BP01 rather than deleting it silently.
--
-- ⚠️ That protection is the database's, NOT a gate's. `migration_drop_dependents`
-- parses `DROP (MATERIALIZED VIEW|TABLE|VIEW)` only, so a `DROP FUNCTION` is
-- invisible to it — the loud abort at apply time is the whole defence here, and
-- adding CASCADE would remove it (003's lesson: CASCADE turns a refusal into a
-- silent deletion and an exit 0).
DROP FUNCTION IF EXISTS isun_clean_delivery_for_eik(text);

CREATE FUNCTION isun_clean_delivery_for_eik(p_eik text)
RETURNS TABLE (
  eik text, name text, on_time_contracts integer,
  clean_contracts bigint, programmes jsonb, absence_meaning text,
  beneficiary_listed boolean, contracts jsonb
)
--
-- ⚠️ QUALIFY EVERY REFERENCE IN THIS BODY. Four OUT names — `eik`, `name`,
-- `programmes`, `contracts` — collide with columns of the tables it reads, and
-- PostgreSQL resolves such a collision toward the COLUMN with no error and no
-- ambiguity warning. `isun_clean_delivery_coverage` is the dangerous one: its
-- `contracts` and `programmes` are REGISTER-WIDE (9,940 / every programme), so a
-- future edit that drops a qualifier substitutes a corpus figure for a
-- per-company one and renders it against a named company with nothing failing.
-- Measured with a throwaway function: an unqualified `contracts` returns 9940.
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH b AS (
    SELECT * FROM isun_clean_beneficiary WHERE eik = p_eik
  ), c AS (
    SELECT * FROM isun_clean_contract WHERE beneficiary_eik = p_eik
  )
  SELECT
    p_eik,
    coalesce(
      (SELECT b.name FROM b),
      (SELECT c.beneficiary_name FROM c
        WHERE c.beneficiary_name IS NOT NULL ORDER BY c.beneficiary_name LIMIT 1)),
    (SELECT b.on_time_contracts FROM b),          -- NULL when not listed as a beneficiary
    (SELECT count(*) FROM c),
    -- ORDER stated, not inherited from DISTINCT's implementation sort — the
    -- aggregate below spells its order out and payloads here are pinned.
    (SELECT coalesce(jsonb_agg(DISTINCT c.programme ORDER BY c.programme), '[]'::jsonb)
       FROM c WHERE c.programme IS NOT NULL),
    (SELECT cov.absence_meaning FROM isun_clean_delivery_coverage cov WHERE cov.id = 1),
    EXISTS (SELECT 1 FROM b),
    -- Bounded by the corpus: the busiest EIK holds 12 clean contracts.
    (SELECT coalesce(jsonb_agg(r ORDER BY r.closed_on DESC NULLS LAST,
                                        r.contract_number), '[]'::jsonb)
       FROM (SELECT c.contract_number, c.title, c.programme, c.procedure,
                    c.signed_on, c.original_end_on, c.closed_on, c.duration_months
               FROM c) r)
  -- No row when the EIK is in NEITHER register: absence is not a finding, and the
  -- serving surface mounts on a present row only.
  WHERE EXISTS (SELECT 1 FROM b) OR EXISTS (SELECT 1 FROM c);
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON isun_clean_contract, isun_clean_beneficiary,
                    isun_clean_delivery_coverage TO app_readonly;
    GRANT EXECUTE ON FUNCTION isun_clean_delivery_for_eik(text) TO app_readonly;
  ELSE
    -- ⚠️ NOT MERELY „granted nothing". The three tables are CREATE TABLE IF NOT
    -- EXISTS, so their ACLs survive a re-apply — but the function above is
    -- DROP + CREATE, so this skip leaves it with LESS privilege than it had, and
    -- the migration still reports success. The pool connects as app_readonly, so
    -- the next /api/db/company raises 42501 (the route degrades and logs it).
    RAISE WARNING 'app_readonly absent — 175 granted nothing, and the DROP+CREATE above '
                  'has REVOKED any EXECUTE isun_clean_delivery_for_eik already had. '
                  '/api/db/company serves no clean-delivery until db:pg:bootstrap runs '
                  'and 175 is re-applied.';
  END IF;
END $$;
