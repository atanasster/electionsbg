-- awarder_declared_officers(eik) — the people who told the Сметна палата they
-- work at this buyer.
--
-- „Who was authorised to run procurement at this buyer, in this year" is not
-- published anywhere in Bulgaria. It is answerable here because two things line
-- up: 2,848 filings carry the category „Упълномощено лице по ЗОП", and
-- `declaration.filed_institution` is the declarant's OWN stated employer, which
-- `declaration_employer_link` (165) resolves to a buyer EIK. Measured: 431
-- procurement officers across 194 buyers, and 47 directors across 34 cultural
-- institutes.
--
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT THIS CLAIMS, PRECISELY — because it is one word away from claiming more.
--
-- It claims: THIS PERSON DECLARED, under their own name and legal obligation,
-- that they work at an institution whose name resolves to this EIK.
--
-- It does NOT claim they signed a particular contract, held the post on a
-- particular date, or still hold it. The filing is dated; the post is not.
--
-- The employer→EIK step is a NAME match, and the repo's rule is that a name match
-- is not an identity — so 165 refuses any employer naming more than one
-- organisation anywhere it can check, and this function inherits that refusal
-- rather than re-deciding it. What is NOT a name match is the person↔employer
-- step: the declarant wrote it themselves.
-- ═══════════════════════════════════════════════════════════════════════════════

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION awarder_declared_officers(p_eik text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH f AS (
    -- GROUPED BY person_id, NOT by name. The register spells one filer's name
    -- more than one way — „Васил Стоянов Василев" and „Васил Стоянов Васасилев"
    -- are person 58778, the second a typo — and grouping on the string published
    -- BOTH as named directors of Народен театър „Иван Вазов", so the page
    -- asserted the existence of a public official who does not exist. Three more
    -- institutes had the same duplication.
    --
    -- The name shown is the register's MOST FREQUENT spelling for that person,
    -- which is the closest thing to a canonical form the source offers. A filer
    -- the person layer has not resolved keeps a NULL person_id and falls back to
    -- grouping by name — one row per unresolved spelling is the honest outcome
    -- there, since nothing connects them.
    SELECT COALESCE(d.person_id::text, 'n:' || d.declarant_name) AS grp,
           d.person_id,
           (array_agg(d.declarant_name ORDER BY cnt.n DESC, d.declarant_name))[1]
             AS declarant_name,
           d.category,
           -- The declarant's own words for where they work, kept verbatim: the
           -- registry name this resolved to is OUR match, not their statement.
           min(d.filed_institution) AS declared_employer,
           min(d.filed_position)    AS declared_position,
           min(d.declaration_year)  AS first_year,
           max(d.declaration_year)  AS last_year,
           count(*)                 AS filings
      FROM declaration d
      JOIN declaration_employer_link l
        ON l.employer_fold = lower(
             regexp_replace(
               btrim(replace(d.filed_institution, U&'\00A0', ' ')),
               '\s+', ' ', 'g'))
      -- How often the register spells this person's name each way, so the most
      -- common spelling wins above.
      JOIN LATERAL (
        SELECT count(*) AS n FROM declaration d2
         WHERE d2.declarant_name = d.declarant_name
           AND d2.person_id IS NOT DISTINCT FROM d.person_id
      ) cnt ON true
     WHERE l.eik = p_eik
       AND d.filed_institution IS NOT NULL
     GROUP BY COALESCE(d.person_id::text, 'n:' || d.declarant_name),
              d.person_id, d.category
  )
  SELECT jsonb_build_object(
    'eik', p_eik,
    'people', COALESCE(jsonb_agg(jsonb_build_object(
      'name',             f.declarant_name,
      'category',         f.category,
      'declaredEmployer', f.declared_employer,
      'declaredPosition', f.declared_position,
      'firstYear',        f.first_year,
      'lastYear',         f.last_year,
      'filings',          f.filings,
      -- NULL when the person layer has not resolved this filer. A missing slug
      -- means „no profile to link", never „not a real person".
      'slug', (SELECT p.slug FROM person p WHERE p.person_id = f.person_id)
    ) ORDER BY f.last_year DESC, f.declarant_name), '[]'::jsonb)
  )
  FROM f;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION awarder_declared_officers(text) TO app_readonly;
  END IF;
END $$;
