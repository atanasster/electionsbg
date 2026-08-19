-- ЦПРС — Централен професионален регистър на строителя (plan P2).
--
-- WHAT IT ANSWERS THAT NOTHING ELSE DOES: „did this contractor hold the required
-- construction licence class on the award date?" The ЗОП eligibility test on
-- every works contract, and it is answerable nowhere else on the Bulgarian web.
--
-- Grain is (eik, class_code): 106,508 licences across 8,379 firms.
--
-- ⚠️ ОБЛАСТ IS THE FIRM'S SEAT AND LIVES ON `cprs_firm`, not here. The register
-- is queried per област, which invites modelling it as a per-licence territory.
-- Measured over the full crawl: every licence carries exactly ONE област and NO
-- firm's област varies by class (0 of 8,379). Modelling it on the licence row
-- was a 30-element array per row for one scalar per firm.
--
-- ⚠️ `first_protocol_date` IS THE POINT, and it is nullable. 106,482 of 106,508
-- rows carry one (2007→2026); a NULL means „the register does not say when",
-- NEVER „not licensed" and never „licensed since forever". An as-of-date query
-- must be explicit about what it does with NULLs — treating NULL as „always
-- held" would clear every contractor the register happens to be silent about.
--
-- The 26 nulls are the residue of the three date spellings КСБ mixes
-- („24.04.2025г.", „…2025 г.", „1.9.2018"). A strict dd.mm.yyyy parse left
-- 38,626 undated — 36% of the register, and the field it exists for. If the
-- null count grows materially, the parser has met a fourth spelling.

CREATE TABLE IF NOT EXISTS cprs_licence (
  eik                 text NOT NULL,
  class_code          text NOT NULL,
  class_label         text NOT NULL,
  -- A group header (`10`,`20`…) rather than a specific class. Kept because it is
  -- the only way a firm licensed for a whole group with no sub-class appears at
  -- all — but it must be excluded from „which class" answers, or a firm shows as
  -- holding both „ПЪРВА ГРУПА" and „1.2" and is double-counted.
  is_group            boolean NOT NULL DEFAULT false,
  first_protocol_no   text,
  first_protocol_date date,
  -- The id is not ЕИК-shaped: a foreign builder, or a register typo. It cannot
  -- join `contracts.contractor_eik`. Stored and flagged rather than dropped —
  -- the same rule the supplier-identity layer follows for its unclassifiable ids.
  unjoinable          boolean NOT NULL DEFAULT false,
  loaded_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (eik, class_code)
);

CREATE TABLE IF NOT EXISTS cprs_firm (
  eik       text PRIMARY KEY,
  name      text NOT NULL,
  -- The област КСБ files the firm under — its SEAT, one per firm (measured).
  oblast    text,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cprs_licence_class ON cprs_licence (class_code);
CREATE INDEX IF NOT EXISTS idx_cprs_licence_date  ON cprs_licence (first_protocol_date);

-- Role-guarded GRANT (the 117/130 shape): roles are CLUSTER-wide, so a virgin
-- pgdata volume has no app_readonly and a bare GRANT would 42704 and roll the
-- whole file back.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON cprs_licence, cprs_firm TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — cprs_licence/cprs_firm ship with no ACL. Run npm run db:pg:bootstrap (local) or roles_readonly.sql (cloud).';
  END IF;
END $$;

-- Which classes a contractor holds, as of a date.
--
-- ⚠️ `p_as_of` NULL means „ever", not „today". The two differ for every firm
-- whose licence post-dates a contract, which is the whole question — so the
-- caller states which it wants rather than inheriting a default that flatters.
CREATE OR REPLACE FUNCTION cprs_classes_for(p_eik text, p_as_of date DEFAULT NULL)
RETURNS TABLE (class_code text, class_label text, since date)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT l.class_code, l.class_label, l.first_protocol_date
    FROM cprs_licence l
   WHERE l.eik = p_eik
     AND NOT l.is_group
     -- A row with no date is NOT assumed to predate the query. It is excluded
     -- from an as-of question and included in an „ever" one, so a silent
     -- register can never certify eligibility it did not state.
     AND (p_as_of IS NULL
          OR (l.first_protocol_date IS NOT NULL AND l.first_protocol_date <= p_as_of))
   ORDER BY l.class_code;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION cprs_classes_for(text, date) TO app_readonly;
  END IF;
END $$;
