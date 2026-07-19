-- 084_person_connections.sql — person↔person edges on person_id (plan Phase 4 + §8).
-- The first, highest-signal edge: two PUBLIC persons who are officers/owners of the SAME
-- company (Търговски регистър). Backs the Connections component (§8) and the future
-- personConnections AI tool.
--
-- SAFETY (this is the defamation-sensitive surface):
--   • Both endpoints must be public figures (§6 privacy — never surface a private
--     co-owner) and status='active' (§3 public-surface rule).
--   • ASSOCIATION-NOISE GUARD: a company with many public officers is a board / a
--     professional association (the judges'/prosecutors' associations, Национално
--     движение Русофили, …), not a business tie — co-membership there is not a
--     meaningful connection and would over-link the graph. We drop any company with more
--     than MAX_CO_OFFICERS (6) public officers. Measured: keeps 308 real ties, excludes 7
--     mass-membership orgs.
--   • The identity disclaimer is baked into the payload so a consumer (page or narration)
--     can never drop it.
CREATE OR REPLACE FUNCTION person_connections(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH subj AS (
    SELECT person_id, slug, display_name FROM person
     WHERE slug = p_slug AND status = 'active' AND is_public_figure
     LIMIT 1
  ),
  -- distinct-public-officer count per company (the association-noise guard input); over
  -- the ~9k bridged tr person_role rows only, so it is cheap.
  co AS (
    SELECT r.ref AS eik, count(DISTINCT r.person_id) AS officers
      FROM person_role r JOIN person p USING (person_id)
     WHERE r.source IN ('tr','ngo') AND p.is_public_figure AND p.status = 'active'
     GROUP BY r.ref
  ),
  -- the subject's own companies that are small enough to be a real tie (<= 6 officers)
  subj_co AS (
    SELECT DISTINCT r.ref AS eik
      FROM person_role r
      JOIN subj ON subj.person_id = r.person_id
      JOIN co ON co.eik = r.ref AND co.officers <= 6
     WHERE r.source IN ('tr','ngo')
  ),
  -- every OTHER public person on one of those companies
  rel AS (
    SELECT r.person_id, r.ref AS eik
      FROM person_role r
      JOIN person p USING (person_id)
      JOIN subj_co s ON s.eik = r.ref
     WHERE r.source IN ('tr','ngo') AND p.is_public_figure AND p.status = 'active'
       AND r.person_id <> (SELECT person_id FROM subj)
  ),
  agg AS (
    SELECT rel.person_id,
           jsonb_agg(DISTINCT jsonb_build_object('eik', rel.eik, 'name', c.name)) AS companies,
           count(DISTINCT rel.eik) AS shared
      FROM rel LEFT JOIN tr_companies c ON c.uic = rel.eik
     GROUP BY rel.person_id
  )
  SELECT jsonb_build_object(
    'subject', (SELECT jsonb_build_object('slug', slug, 'name', display_name) FROM subj),
    'related', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', p.slug, 'name', p.display_name,
        'sharedCount', a.shared, 'companies', a.companies
      ) ORDER BY a.shared DESC, p.display_name)
      FROM agg a JOIN person p ON p.person_id = a.person_id
    ), '[]'::jsonb),
    'disclaimer', 'Връзките са по съвпадение на име и обща фирма — насока, не категорично доказателство.'
  )
  FROM subj;
$$;
