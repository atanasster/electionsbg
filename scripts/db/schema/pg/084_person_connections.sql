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
  ),
  -- INDIRECT: A → C1 → P (a DIRECT connection) → C2 → B, where B shares no company with A.
  -- One representative A∩P company (C1) per partner P.
  p_c1 AS (
    SELECT DISTINCT ON (person_id) person_id AS p_id, eik AS c1
      FROM rel ORDER BY person_id, eik
  ),
  -- P's OTHER small companies (C2), not already shared with A.
  p_co AS (
    SELECT DISTINCT a.person_id AS p_id, r.ref AS eik
      FROM agg a
      JOIN person_role r ON r.person_id = a.person_id AND r.source IN ('tr','ngo')
      JOIN co ON co.eik = r.ref AND co.officers <= 6
     WHERE r.ref NOT IN (SELECT eik FROM subj_co)
  ),
  -- B on C2, excluding the subject, the direct connections, and P itself. One path per B.
  indirect AS (
    SELECT DISTINCT ON (r.person_id) r.person_id AS b_id, pc.p_id, pc.eik AS c2
      FROM p_co pc
      JOIN person_role r ON r.ref = pc.eik AND r.source IN ('tr','ngo')
      JOIN person p USING (person_id)
     WHERE p.is_public_figure AND p.status = 'active'
       AND r.person_id <> (SELECT person_id FROM subj)
       AND r.person_id NOT IN (SELECT person_id FROM agg)
       AND r.person_id <> pc.p_id
     ORDER BY r.person_id, pc.eik
  )
  SELECT jsonb_build_object(
    'subject', (SELECT jsonb_build_object('slug', slug, 'name', display_name) FROM subj),
    -- DIRECT: A ─shared company─ B. `companies` carries the bridge company(ies).
    'related', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', p.slug, 'name', p.display_name,
        'party', pty.party_nick, 'partyColor', pty.party_color,
        'sharedCount', a.shared, 'companies', a.companies
      ) ORDER BY a.shared DESC, p.display_name)
      FROM agg a JOIN person p ON p.person_id = a.person_id
      LEFT JOIN LATERAL (
        SELECT party_nick, party_color FROM person_election_stats pes
         WHERE pes.person_id = p.person_id AND pes.party_nick IS NOT NULL
         ORDER BY pes.election_date DESC LIMIT 1) pty ON true
    ), '[]'::jsonb),
    -- INDIRECT: A → C1 → partner → C2 → B.
    'indirect', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', pb.slug, 'name', pb.display_name,
        'party', pty.party_nick, 'partyColor', pty.party_color,
        'partnerSlug', pp.slug, 'partnerName', pp.display_name,
        'c1', jsonb_build_object('eik', pc1.c1, 'name', cc1.name),
        'c2', jsonb_build_object('eik', i.c2, 'name', cc2.name)
      ) ORDER BY pb.display_name)
      FROM indirect i
      JOIN person pb ON pb.person_id = i.b_id
      JOIN person pp ON pp.person_id = i.p_id
      JOIN p_c1 pc1 ON pc1.p_id = i.p_id
      LEFT JOIN tr_companies cc1 ON cc1.uic = pc1.c1
      LEFT JOIN tr_companies cc2 ON cc2.uic = i.c2
      LEFT JOIN LATERAL (
        SELECT party_nick, party_color FROM person_election_stats pes
         WHERE pes.person_id = pb.person_id AND pes.party_nick IS NOT NULL
         ORDER BY pes.election_date DESC LIMIT 1) pty ON true
    ), '[]'::jsonb),
    'disclaimer', 'Връзките са по съвпадение на име и обща фирма — насока, не категорично доказателство.'
  )
  FROM subj;
$$;
