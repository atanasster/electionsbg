-- 186_mayor_pay.sql — declared mayor pay vs. município population.
--
-- Built auditing gospodari.com's 2026-08-24 "kmet salaries" article against our own
-- declarations corpus: every figure it cited checked out, but nothing on the site let a
-- reader see the comparison for themselves. Plan: docs/plans/mayor-salary-transparency-v1.md.
--
-- APPLIED, NEVER LOADED — same shape as `municipal_fiscal_by_obshtina` / `person_connections`.
-- Both functions read live rows from `municipal_officials_table`, `declaration`,
-- `declaration_income`, `obshtina_population` and `place_dim`; nothing here is materialized,
-- so there is no reload trigger to document — the answer moves the moment any of those
-- tables does. Apply with `apply_functions.ts 186_mayor_pay.sql`.
--
-- ⚠️ THE OBSHTINA CODE COMES FROM THE PERSON-IDENTITY LAYER, NOT FROM PARSING
-- `declaration.institution`. `municipal_officials_table.obshtina` is `person_role.place_code`
-- (migration 115), resolved offline by `scripts/officials/municipality_join.ts` with four
-- fallback strategies and Sofia's 24 district councils handled — reusing it here is what
-- avoids rebuilding a second, worse copy of that resolver. Verified 2026-08-25 against
-- `place_dim`: zero of 261 city-wide sitting-mayor obshtina codes fail to resolve.
--
-- ⚠️ THE BENCH FILTER IS `district IS NULL`, and skipping it publishes five phantom
-- "municipalities". Varna and Plovdiv each run their own within-city райони with their own
-- сitting "mayor" row tagged under the SAME parent obshtina code as the city-wide mayor (Sofia
-- keeps its 24 districts on separate `S25xx` codes instead) — measured, VAR06 carries 6
-- sitting "mayor" listings and PDV22 carries 7. `district IS NULL` is the exact predicate
-- migration 102's own `idx_municipal_officials_citywide[_bench]` indexes exist to serve for
-- the same reason.
--
-- ⚠️ `income_eur` IS THE ONE "Годишна данъчна основа от трудови доходи" ROW, NEVER
-- `incomeTotals`'s per-declarant SUM (`src/lib/declarations.ts`). That helper deliberately
-- folds every declared-income category for one person into one number — rent, dividends,
-- another employer, this position's own salary — because it answers "what does this person
-- report as income". This answers a narrower, different question: "what did the município pay
-- its mayor". Summing categories here would let a rented-out apartment or a spouse's business
-- inflate a figure a reader takes to be a public salary. Measured: Несебър's mayor's 2025
-- filing carries a second declarant-side row (rental income, ~51,129 EUR) that a SUM would
-- silently add to a salary the article — and this function — both report as 61,038 EUR.
--
-- ⚠️ A MISSING ROW MEANS "NOT ON FILE", NEVER "€0". `income_eur` is NULL for a sitting mayor
-- with no matching declaration (no filing yet, or a filing whose income table this parser
-- could not read) — via a LEFT JOIN LATERAL, so every real municipality's mayor still appears
-- in `mayor_pay_ranking`'s output with a population and a NULL pay, rather than silently
-- disappearing. A consumer computing coverage counts `income_eur IS NOT NULL` over the full
-- (unlimited) call, never assumes the returned set is complete.
--
-- ⚠️ TWO CANDIDATES WITH A VALID FILING IS REFUSED, NOT TIE-BROKEN. Varna/Plovdiv-style
-- within-city райони are excluded by `district IS NULL` above, but a SEPARATE, genuine
-- shape survives it: a município mid-way through replacing its mayor can briefly carry two
-- "sitting, no district" listings for the SAME seat (measured 2026-09-04: PAZ20 only —
-- RSE04 was on this list until the obshtina join stopped resolving Бяла/Варна/ onto Бяла
-- (Русе)'s code, which is what had given RSE04 two mayors; see
-- docs/plans/officials-roster-missing-mayor-v1.md),
-- and — unlike the within-city case — nothing on `municipal_officials_table` says which one
-- is current (no term-start date). Both candidates in both measured cases have a real 2025
-- Annualy Кмет declaration on file, so ANY tie-break here would silently attribute one
-- specific named person's declared pay to the município on the strength of a coin flip
-- (an earlier draft used alphabetical `official_slug` order, which is exactly that coin
-- flip). Rather than guess, `ambiguous` drops such municipalities from the whole function's
-- output — the same "refuse rather than guess" rule this repo applies to every other
-- ambiguous-identity join (`aop_expert_person_links()`, `tr_owner_share`). Revisit if
-- `official_roster`/`municipal_officials_table` ever gains a term-start date to break the
-- tie on.
--
-- `position_title = 'Кмет'` is a FILTER KEY read from the register's own listing value, not
-- a rendered label — see `mayor_pay_ranking`'s entry in
-- `LISTING_LABEL_EXCEPTIONS` (scripts/db/tests/declaration_filed_position.data.test.ts) for
-- why this does not route through `declared_label()`.
--
-- `declaration_id` is cast to `int`, not left as `declaration.declaration_id`'s native
-- `bigint` — node-postgres parses a PG bigint (OID 20) as a JS STRING to avoid precision
-- loss, and this pool registers no OID-20 type-parser override, so an uncast bigint here
-- would serve as `"12345"` while every TS consumer declares `number`. `declaration_id` is a
-- `bigserial` handed out well within int4 range, so the cast is lossless.

-- DROP before CREATE: this function's OUT columns changed (declaration_id bigint -> int),
-- and CREATE OR REPLACE cannot change a function's OUT-parameter row type (42P13) — see
-- municipal_fiscal_ranking's identical note in 149_municipal_fiscal.sql.
DROP FUNCTION IF EXISTS mayor_pay_ranking(int);
CREATE OR REPLACE FUNCTION mayor_pay_ranking(
  p_limit int DEFAULT 300
) RETURNS TABLE (
  obshtina text, name_bg text, name_en text, oblast_code text,
  mayor_name text, mayor_slug text,
  declaration_id int, fiscal_year int, source_url text,
  income_eur double precision,
  population int,
  -- Deliberately INVERTED from every other per-capita figure on the site: a SMALL
  -- population makes this LARGE. That is the whole finding this function exists to
  -- surface — a bare "per capita" label would read as the usual "smaller is fairer"
  -- direction this repo's other per-capita pages use, so the column is named for
  -- what it counts (residents per 1,000) rather than reused from that convention.
  income_per_1000_residents_eur double precision
) LANGUAGE sql STABLE AS $$
  WITH candidates AS (
    -- Every "sitting, no district" mayor LISTING for a real município — not yet
    -- deduplicated. Normally exactly one per obshtina; `ambiguous` below is what
    -- happens when it is not.
    SELECT moc.obshtina, moc.official_slug, moc.person_slug, moc.name AS mayor_name
    FROM municipal_officials_table moc
    WHERE moc.role = 'mayor' AND moc.is_sitting AND moc.district IS NULL
      AND (moc.obshtina ~ '^[A-Z]{3}[0-9]{2}$' OR moc.obshtina = 'SFO_CITY')
  ), eligible AS (
    -- The candidate's pay-eligible filing, using the EXACT predicate this function
    -- publishes on — not a looser proxy, which is what let an earlier version of
    -- this query pick the wrong listing on a tie.
    SELECT c.obshtina, c.official_slug, c.person_slug, c.mayor_name,
           d.declaration_id, d.fiscal_year, d.source_url,
           di.eur_declarant AS income_eur
    FROM candidates c
    LEFT JOIN LATERAL (
      SELECT d2.declaration_id::int AS declaration_id, d2.fiscal_year, d2.source_url
      FROM declaration d2
      WHERE d2.subject_ref = c.official_slug AND d2.tier = 'muni'
        AND d2.position_title = 'Кмет' AND d2.declaration_type = 'Annualy'
      ORDER BY d2.fiscal_year DESC, d2.declaration_id DESC
      LIMIT 1
    ) d ON true
    LEFT JOIN declaration_income di
      ON di.declaration_id = d.declaration_id
     AND di.category = 'Годишна данъчна основа от трудови доходи'
  ), ambiguous AS (
    SELECT obshtina FROM eligible
    WHERE declaration_id IS NOT NULL
    GROUP BY obshtina HAVING count(*) > 1
  ), pay AS (
    SELECT DISTINCT ON (e.obshtina)
           e.obshtina, e.mayor_name, e.person_slug,
           e.declaration_id, e.fiscal_year, e.source_url, e.income_eur
    FROM eligible e
    WHERE e.obshtina NOT IN (SELECT obshtina FROM ambiguous)
    -- Same-obshtina candidates left after the ambiguity filter never have more
    -- than one WITH a filing, so this is only breaking ties among candidates
    -- that have none — deterministic, and never chooses between two real filings.
    ORDER BY e.obshtina, (e.declaration_id IS NOT NULL) DESC, e.official_slug
  )
  SELECT p.obshtina, COALESCE(pd.name_bg, p.obshtina), pd.name_en, pd.oblast_code,
         p.mayor_name, p.person_slug,
         p.declaration_id, p.fiscal_year, p.source_url,
         p.income_eur,
         op.population,
         CASE WHEN op.population > 0 AND p.income_eur IS NOT NULL
              THEN p.income_eur / op.population * 1000 END AS income_per_1000_residents_eur
  FROM pay p
  LEFT JOIN place_dim pd ON pd.kind = 'obshtina' AND pd.code = p.obshtina
  -- Sofia: `moc.obshtina` = place_dim.code `SFO_CITY`, but `obshtina_population` (NSI
  -- Census 2021) keys the city on `SOF00` — the same governance_code bridge
  -- `municipal_fiscal_by_obshtina` uses, for the identical reason.
  LEFT JOIN obshtina_population op ON op.obshtina = COALESCE(pd.governance_code, pd.code)
  -- Ordering by the output column's own alias (legal here — a plain top-level
  -- SELECT, no set operation) rather than repeating the CASE, so the two can
  -- never desync the way a copy-pasted second copy eventually does.
  ORDER BY income_per_1000_residents_eur DESC NULLS LAST,
           p.income_eur DESC NULLS LAST
  LIMIT CASE WHEN p_limit IS NULL THEN NULL ELSE LEAST(GREATEST(p_limit, 1), 1000) END;
$$;

-- One município's detail, for the `/governance/:id` stat tile — same corpus as the ranking
-- above, plus the rank/peer-count pair so the tile needs one small request rather than the
-- whole ranking. Peer set = every município with a computable ratio, matching
-- `municipal_fiscal_by_obshtina`'s own same-cohort-only rule for a rank.
CREATE OR REPLACE FUNCTION mayor_pay_by_obshtina(
  p_obshtina text
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH ranked AS (
    SELECT *, rank() OVER (ORDER BY income_per_1000_residents_eur DESC NULLS LAST) AS rnk,
           count(*) FILTER (WHERE income_per_1000_residents_eur IS NOT NULL)
             OVER () AS ranked_count
    FROM mayor_pay_ranking(NULL)
  )
  SELECT to_jsonb(row) FROM (
    SELECT obshtina, name_bg, name_en, oblast_code, mayor_name, mayor_slug,
           declaration_id, fiscal_year, source_url, income_eur, population,
           income_per_1000_residents_eur,
           CASE WHEN income_per_1000_residents_eur IS NOT NULL THEN rnk END AS rank,
           ranked_count
    FROM ranked WHERE obshtina = p_obshtina
  ) row;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION mayor_pay_ranking(int) TO app_readonly;
    GRANT EXECUTE ON FUNCTION mayor_pay_by_obshtina(text) TO app_readonly;
  END IF;
END $$;
