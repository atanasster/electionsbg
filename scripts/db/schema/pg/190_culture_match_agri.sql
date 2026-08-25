-- GENERATED FILE — DO NOT EDIT.
-- Source: src/lib/cultureMatch.ts
-- Generator: scripts/db/gen_sql/culture_match.ts
-- Regenerate: npm run gen:culture-sql   ·   Verify: npm run gen:culture-sql -- --check
--
-- One of THREE files behind the /culture/funds source pages, split by corpus so
-- that each is applied by the loader that owns its table, in the same run that
-- created it. Applier: scripts/agri/ingest.ts (it owns agri_subsidies and applies 046).
--
-- ⚠️⚠️ THE FOUR VIEWS ACROSS THESE THREE FILES MAY NEVER BE SUMMED. They are one
-- ИСУН contract value reached by the register's EIKs, the same contract value
-- reached by a name rule (the two overlap heavily and NEITHER contains the other),
-- a ДФЗ farm SUBSIDY, and an Interreg partner's published BUDGET. No UNION of
-- them may be created, and no consumer may add two of their euro columns.

-- culture_agri_chitalishta — a ДФЗ farm SUBSIDY, not a contract value. No state
-- cultural institution receives one: culture's presence in this corpus is народни
-- читалища, and it is reachable only by NAME (an EIK filter over the register
-- finds one music school on „Училищни схеми", €5,416 — see sectorPacks.ts).
DROP VIEW IF EXISTS culture_agri_chitalishta;
CREATE VIEW culture_agri_chitalishta AS
  SELECT
         id,
         year,
         eik,
         name,
         oblast AS oblast_name,
         scheme,
         scheme_desc,
         total_eur AS subsidy_eur
    FROM agri_subsidies
   WHERE (name ~* 'читалищ');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON culture_agri_chitalishta TO app_readonly;
  END IF;
END $$;
