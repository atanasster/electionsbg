-- GENERATED FILE — DO NOT EDIT.
-- Source: src/lib/cultureMatch.ts + src/lib/kulturaReferenceData.ts
-- Generator: scripts/db/gen_sql/culture_match.ts
-- Regenerate: npm run gen:culture-sql   ·   Verify: npm run gen:culture-sql -- --check
--
-- One of THREE files behind the /culture/funds source pages, split by corpus so
-- that each is applied by the loader that owns its table, in the same run that
-- created it. Applier: scripts/db/load_funds_pg.ts (it owns fund_projects).
--
-- ⚠️⚠️ THE FOUR VIEWS ACROSS THESE THREE FILES MAY NEVER BE SUMMED. They are one
-- ИСУН contract value reached by the register's EIKs, the same contract value
-- reached by a name rule (the two overlap heavily and NEITHER contains the other),
-- a ДФЗ farm SUBSIDY, and an Interreg partner's published BUDGET. No UNION of
-- them may be created, and no consumer may add two of their euro columns.

-- culture_isun_by_eik — reached by the sector register's EIKs. Reproducible, and
-- ALMOST but not quite a subset of the row below: measured 2026-08-25, 46 of its
-- 47 projects are also name-matched. See hub_stats' eikExactAlsoByName.
DROP VIEW IF EXISTS culture_isun_by_eik;
CREATE VIEW culture_isun_by_eik AS
  SELECT
         contract_number,
         beneficiary_eik,
         beneficiary_name,
         program_code,
         program_name,
         title,
         total_eur,
         grant_eur,
         own_cofinance_eur,
         paid_eur,
         duration_months,
         status,
         org_type,
         oblast AS oblast_code
    FROM fund_projects
   WHERE beneficiary_eik = ANY (ARRAY[
    '000695160', '000695833', '130418031', '201570119', '000670748', '000670805',
    '000670794', '000670787', '000670883', '000670890', '117103220', '115314988',
    '102241054', '000405995', '000083665', '176812208', '000673210', '000670984',
    '000675880', '000672293', '124609886', '175932425', '108505799', '123089870',
    '000804072', '121710606', '000044566', '000154660', '831154303', '000212722',
    '000403460', '000610128', '000044210', '000522379', '000083302', '000669799',
    '000669678', '000669781', '000458930', '000582700', '000455029', '000803725',
    '000807453', '000585002', '000458948', '000124037', '000282756', '000403802',
    '000014352', '000867998', '000455489', '126004416', '000522703', '112582278',
    '000210326', '127508351', '000608604', '000153836', '000185307', '831381016',
    '000669774', '000669802', '000674508'
  ]);

-- culture_isun_by_name — a floor with a fuzzy edge; mostly народни читалища.
DROP VIEW IF EXISTS culture_isun_by_name;
CREATE VIEW culture_isun_by_name AS
  SELECT
         contract_number,
         beneficiary_eik,
         beneficiary_name,
         program_code,
         program_name,
         title,
         total_eur,
         grant_eur,
         own_cofinance_eur,
         paid_eur,
         duration_months,
         status,
         org_type,
         oblast AS oblast_code
    FROM fund_projects
   WHERE (beneficiary_name ~* 'читалищ|музе|теат|галери|библиотек|филхармони|ансамб|художествен|изкуств|\yопера\y|\yоперен|\yоперна|\yкино\y|\yкинот|култур' AND beneficiary_name !~* 'аквакултур|агр[иоа]култур|фуражн|полск(и|а) култур|земеделск(и|а) култур|растителн|култури\y|изкуствен|оператор|операц|оператив|кооперат');

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON culture_isun_by_eik, culture_isun_by_name TO app_readonly;
  END IF;
END $$;
