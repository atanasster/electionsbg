-- 092_accumulation_gap.sql — the accumulation-gap metric (audit T3.2 / feature 3.2).
--
-- Δ declared net worth between the first and last filing, against the income declared over
-- the same span. This is the discrepancy КПКОНПИ is statutorily meant to examine and which
-- is published nowhere else in an accessible form.
--
-- IT NAMES INDIVIDUALS, so it is governed by the editorial gate in 091 and the published
-- methodology (published at /about#accumulation-gap). Four rules are enforced HERE, in the
-- serving function, because a caller cannot be trusted to re-derive them:
--
--   1. THE COHORT. Only person_is_accountability_senior() — and only an active, public
--      person. A councillor or a lower official gets NULL and the page renders nothing.
--
--   2. COMPLETE INCOME COVERAGE, or nothing. Δ net worth spans fromYear→toYear, so the
--      income it is compared against must cover the SAME years. 336 of 815 otherwise-
--      eligible people have gaps in their filing history — one spans 2016→2025 but filed
--      in only 4 of those years, and comparing a 10-year wealth change against 4 years of
--      income manufactures a €188k "gap" out of six silently discarded years. So the
--      function returns NULL unless every year in the span carries a filing. Under-
--      inclusive by design: a figure we cannot compute honestly is one we do not publish.
--
--   3. THE OFF-BY-ONE. Income is summed over (fromYear, toYear] — NOT including fromYear.
--      The Δ is measured from the fromYear SNAPSHOT, so only income earned after that
--      snapshot could have produced it. Including fromYear's income overstates income and
--      understates the gap by ~20-33%.
--
--   4. THE DENOMINATOR. Real estate the declarant left unpriced counts as €0 in net worth,
--      so a gap computed over such a portfolio is not exact. The count travels WITH the
--      figure. It is counted on the LATEST filing only — the snapshot whose net worth is
--      reported — because summing every row the person ever filed restates the same
--      property once per year (one person reported 80 unvalued rows whose latest filing
--      has none). And "unpriced" means value_eur IS NULL **OR = 0**: the €0-priced rows
--      (26,347) outnumber the NULLs (16,172), and counting only NULLs suppressed the
--      caveat entirely for 268 people.
--
-- The function computes; it does not conclude. A positive gap is the part of the wealth
-- change the declared income does not by itself account for — inheritance, restitution, a
-- sale of a previously-owned asset and a spouse's business income all move net worth
-- without appearing as income.

DROP FUNCTION IF EXISTS person_accumulation_gap(text);
CREATE OR REPLACE FUNCTION person_accumulation_gap(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    -- §6 privacy gate + the 091 cohort gate, in that order.
    SELECT p.person_id
      FROM person p
     WHERE p.slug = p_slug
       AND p.status = 'active'
       AND p.is_public_figure
       AND person_is_accountability_senior(p.person_id)
     LIMIT 1
  ),
  yrs AS (
    SELECT w.declaration_year, w.net_eur, w.income_eur, w.declaration_id
      FROM person_wealth_year w JOIN pick ON pick.person_id = w.person_id
  ),
  bounds AS (
    SELECT
      min(declaration_year) AS from_year,
      max(declaration_year) AS to_year,
      count(*)              AS filed_years,
      -- Rule 2: the span must be fully covered. person_wealth_year is unique on
      -- (person_id, year), so filed_years = span exactly when there is no gap.
      max(declaration_year) - min(declaration_year) + 1 AS span_years
      FROM yrs
  ),
  endpoints AS (
    SELECT
      (SELECT net_eur FROM yrs ORDER BY declaration_year ASC  LIMIT 1) AS from_net,
      (SELECT net_eur FROM yrs ORDER BY declaration_year DESC LIMIT 1) AS to_net,
      (SELECT declaration_id FROM yrs ORDER BY declaration_year DESC LIMIT 1) AS to_decl
  ),
  income AS (
    -- Rule 3: strictly AFTER the opening snapshot.
    SELECT COALESCE(SUM(y.income_eur), 0) AS declared_income
      FROM yrs y, bounds b
     WHERE y.declaration_year > b.from_year
  ),
  unvalued AS (
    -- Rule 4: the closing snapshot only, NULL or zero.
    SELECT count(*) AS unvalued_real_estate
      FROM declaration_asset a, endpoints e
     WHERE a.declaration_id = e.to_decl
       AND a.category = 'real_estate'
       AND (a.value_eur IS NULL OR a.value_eur = 0)
  )
  -- Every figure is derived from the ROUNDED endpoints, not rounded independently: a
  -- reader who subtracts the two net worths on the page must get the published Δ, and Δ
  -- minus the published income must give the published gap. Rounding each separately lets
  -- them disagree by €1, which on a defamation-sensitive figure reads as sloppiness.
  SELECT jsonb_build_object(
    'slug', p_slug,
    'fromYear', b.from_year,
    'toYear', b.to_year,
    'years', b.filed_years,
    'fromNetEur', round(e.from_net),
    'toNetEur', round(e.to_net),
    'deltaNetEur', round(e.to_net) - round(e.from_net),
    'declaredIncomeEur', round(i.declared_income),
    -- Deliberately NOT clamped at zero: a NEGATIVE gap (income exceeds the wealth change)
    -- is the ordinary case, and showing it is what keeps the positive one from reading as
    -- an accusation by default.
    'gapEur', (round(e.to_net) - round(e.from_net)) - round(i.declared_income),
    'unvaluedRealEstate', u.unvalued_real_estate
  )
  FROM bounds b, endpoints e, income i, unvalued u
  WHERE b.filed_years >= 2
    -- Rule 2: no gap in the filing history.
    AND b.filed_years = b.span_years
    -- Rule 2 (cont.): a zero income total means the declarations carry no income data for
    -- the span, so the "gap" would be the whole wealth change presented as unexplained.
    -- That is a data absence, not a finding about a person.
    AND i.declared_income > 0;
$$;
