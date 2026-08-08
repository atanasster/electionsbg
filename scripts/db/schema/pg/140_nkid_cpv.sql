-- NKID (НКИД/КИД-2008 = NACE Rev.2) per company + the conservative NACE→CPV
-- crosswalk, for the procurement "declared-activity mismatch" flag
-- (docs/plans/nkid-cpv-mismatch-v1.md, plan §8 B1).
--
-- Three tables, all LOCAL-authored from the CR Deeds capture + the committed TS
-- crosswalk artifact (src/lib/naceCpv.ts), loaded by db:load:cr-nkid:pg. This file
-- only creates the empty shells + grants — the loader fills them and is the single
-- writer, so this migration is safe to (re)apply any time (idempotent).
--
-- ⚠️ THE OPINION TABLE IS NOT REDUNDANT with nace_cpv_allow. A NACE division we
-- have an opinion about but which maps to only cross-cutting (universal) CPV — e.g.
-- printing (18), finance (66), legal (69) — has ZERO rows in nace_cpv_allow yet MUST
-- still fire a mismatch on any non-universal win. So "do we have an opinion?" is
-- `nace_div ∈ nace_cpv_opinion`, NEVER "≥1 row in nace_cpv_allow" (that test would
-- silently make ~10 divisions unavailable and diverge from the TS scorer — the exact
-- SSOT break naceCpv.ts documents). The UNIVERSAL_CPV set lives in the crosswalk
-- artifact + is applied at query time; it is deliberately NOT stored here.

SET check_function_bodies = off;

-- eik → declared NACE (division is the 2-digit grain the CPV crosswalk keys on).
CREATE TABLE IF NOT EXISTS company_nkid (
  eik       text PRIMARY KEY,
  nace_code text,              -- e.g. "86.10" (may be null if only a division survived)
  nace_div  text NOT NULL,     -- e.g. "86" — the join/flag key
  label     text,              -- raw CR_F_6a_L text ("Група по НКИД: 86.10 Клас по НКИД: …"); display only, never joined
  source    text NOT NULL DEFAULT 'registryagency:CR/Deeds'
);
CREATE INDEX IF NOT EXISTS idx_company_nkid_div ON company_nkid (nace_div);

-- The NACE-specific half of the crosswalk (universals excluded — applied at query
-- time). Seeded from naceCpvAllowRows().
CREATE TABLE IF NOT EXISTS nace_cpv_allow (
  nace_div text NOT NULL,
  cpv_div  text NOT NULL,
  PRIMARY KEY (nace_div, cpv_div)
);

-- The set of NACE divisions we have an opinion about (= every key of NACE_CPV_ALLOW,
-- INCLUDING the empty-list ones). Seeded from naceCpvOpinionDivisions().
CREATE TABLE IF NOT EXISTS nace_cpv_opinion (
  nace_div text PRIMARY KEY
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON company_nkid, nace_cpv_allow, nace_cpv_opinion TO app_readonly;
  END IF;
END $$;
