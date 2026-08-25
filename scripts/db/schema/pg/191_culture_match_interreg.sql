-- GENERATED FILE — DO NOT EDIT.
-- Source: src/lib/cultureMatch.ts
-- Generator: scripts/db/gen_sql/culture_match.ts
-- Regenerate: npm run gen:culture-sql   ·   Verify: npm run gen:culture-sql -- --check
--
-- One of THREE files behind the /culture/funds source pages, split by corpus so
-- that each is applied by the loader that owns its table, in the same run that
-- created it. Applier: scripts/db/load_interreg_pg.ts (it owns both interreg tables).
--
-- ⚠️⚠️ THE FOUR VIEWS ACROSS THESE THREE FILES MAY NEVER BE SUMMED. They are one
-- ИСУН contract value reached by the register's EIKs, the same contract value
-- reached by a name rule (the two overlap heavily and NEITHER contains the other),
-- a ДФЗ farm SUBSIDY, and an Interreg partner's published BUDGET. No UNION of
-- them may be created, and no consumer may add two of their euro columns.

-- culture_interreg_thematic — a partner's published BUDGET, joined through the
-- OPERATION's THEME rather than through a beneficiary set. Those are different
-- questions, ~4.4x apart, and only this one is answerable for a corpus in which
-- ~18% of Bulgarian partner rows carry an EIK at all.
--
-- Projected explicitly rather than `p.*, o.*`: both tables carry keep_id, and a
-- star join would emit it twice and break the DbDataTable column contract — and,
-- as for the two ИСУН views, a star view pins every column it expanded against
-- ALTER TYPE and DROP COLUMN.
CREATE OR REPLACE VIEW culture_interreg_thematic AS
  SELECT p.keep_id,
         p.partner_seq,
         p.is_lead,
         p.country_department,
         p.partner_name,
         p.partner_name_en,
         p.eik,
         p.org_type,
         p.budget_eur,
         p.eu_funding_eur,
         p.budget_basis,
         p.ekatte,
         p.obshtina,
         p.oblast,
         o.programme_code,
         o.period,
         o.title_en,
         o.title_bg,
         o.status,
         o.start_date,
         o.end_date
    FROM interreg_partners p
    JOIN interreg_operations o USING (keep_id)
   WHERE p.country = 'Bulgaria'
     AND (o.title_en ~* 'cultur|heritage|museum|theatre|theater|\yart\y|\yarts\y|artistic' AND o.title_en !~* 'agricultur|aquacultur|horticultur|viticultur|apicultur|silvicultur|sericultur|permacultur|maricultur|monocultur|arboricultur|floricultur|piscicultur');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON culture_interreg_thematic TO app_readonly;
  END IF;
END $$;
