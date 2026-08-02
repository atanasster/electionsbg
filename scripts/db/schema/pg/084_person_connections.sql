-- 084_person_connections.sql — person↔person edges (plan Phase 4 + §8; re-pointed onto the unified
-- graph in connections-engine-v1 §P3.5). The highest-signal edge: two persons who co-own/co-manage the
-- SAME company (Търговски регистър). Backs the Connections component (§8), the /api/db/person-connections
-- + graph-ego routes, and the personConnections AI tool.
--
-- RE-POINTED ONTO graph_* (128). It used to traverse person_role/person directly and recompute a
-- per-company public-officer count on every request via public_officer_count(eik) (a COST-500 STABLE
-- function). Both are gone: the traversal now reads graph_edge (co-ownership kinds tr_role/tr_owner —
-- which ARE person_role source tr/ngo by construction, so ZERO data change vs the old body, verified
-- 19,649 companies / 0 mismatches), and the association-noise guard is the PRECOMPUTED
-- graph_company_node.public_officer_count column (an O(1) PK lookup, not a whole-corpus scan). The
-- /person tile and the ego endpoint now share ONE lineage.
--
-- SAFETY (this is the defamation-sensitive surface):
--   • DEFAULT (p_include_private=false): both endpoints must be is_public_figure. The privacy gate is
--     the LIVE person.status='active' + is_public_figure join in EVERY surfacing CTE — that, not the
--     graph snapshot, is what enforces it, so a status flip drops someone immediately. graph_person_node
--     happens to be all-active today (retired persons' roles are reassigned, leaving no edges) but the
--     loader does NOT filter on status, so do not rely on the snapshot as the guarantee.
--   • ASSOCIATION-NOISE GUARD: a company with too many co-owners is a board / professional association /
--     кооперация, not a business tie — dropped at > MAX_CO_OFFICERS (6). The guard population FOLLOWS the
--     toggle: the DEFAULT bounds PUBLIC officers (public_officer_count); the PRIVATE view bounds ALL
--     co-owners (coowner_count). Bounding only the public count in the private view would let a
--     few-public-officer mass-ownership vehicle fan a subject out to scores of named private individuals
--     (measured: 1 public + 123 verified) — which is precisely the over-link the guard exists to stop.
--   • TIER-V TOGGLE (p_include_private=true): relaxes endpoint eligibility to also admit
--     identity_confidence='verified' private owners (never name_fold — those are not real person rows,
--     so they are not in graph_person_node at all) AND switches the guard to coowner_count (above). This
--     is the opt-in surface P4 exposes; the default path is unchanged and behaviour-preserving.
--   • The identity disclaimer is baked into the payload so a consumer can never drop it.

-- The per-request public_officer_count(eik) is RETIRED — it had no caller but this function, and the
-- graph_company_node.public_officer_count column replaces it single-sourced. Drop it so it cannot rot.
DROP FUNCTION IF EXISTS public_officer_count(text);

-- The 1-arg person_connections(text) is SUPERSEDED by the 2-arg (…, boolean DEFAULT false) below.
-- CREATE OR REPLACE with the extra parameter mints a NEW overload rather than replacing the old one,
-- so the old 1-arg must be dropped explicitly — otherwise person_connections('slug') is ambiguous
-- between the 1-arg and the 2-arg-with-default. DROP first so a re-apply is idempotent.
DROP FUNCTION IF EXISTS person_connections(text);

CREATE OR REPLACE FUNCTION person_connections(p_slug text, p_include_private boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  -- ELIGIBILITY IS GATED LIVE ON `person`, not on the graph snapshot. The graph supplies the EDGES,
  -- the guard and the money (all precomputed); WHICH PERSONS may surface is read live from person, so a
  -- status flip to 'review' or a de-flag of is_public_figure drops someone IMMEDIATELY, not at the next
  -- graph rebuild — the privacy contract the old body had. status='active' + is_public_figure (or, with
  -- the toggle, identity_confidence='verified').
  WITH subj AS (
    SELECT person_id, slug, display_name AS name FROM person
     WHERE slug = p_slug AND status = 'active'
       AND (is_public_figure OR (p_include_private AND identity_confidence = 'verified'))
     LIMIT 1
  ),
  -- the subject's own co-ownership companies small enough to be a real tie. The guard population
  -- follows the toggle: DEFAULT bounds PUBLIC officers (public_officer_count); the PRIVATE view bounds
  -- ALL co-owners (coowner_count), so a few-public-officer mass-ownership vehicle (1 public + 123
  -- verified) is excluded from the private fan-out too, not just from the public one.
  subj_co AS (
    SELECT DISTINCT e.eik
      FROM graph_edge e
      JOIN subj ON subj.person_id = e.person_id
      JOIN graph_company_node cn ON cn.eik = e.eik
     WHERE e.kind IN ('tr_role','tr_owner')
       AND (CASE WHEN p_include_private THEN cn.coowner_count ELSE cn.public_officer_count END) <= 6
  ),
  -- every OTHER eligible person on one of those companies (DIRECT). Eligibility LIVE from person.
  rel AS (
    SELECT e.person_id, e.eik
      FROM graph_edge e
      JOIN person p ON p.person_id = e.person_id AND p.status = 'active'
      JOIN subj_co s ON s.eik = e.eik
     WHERE e.kind IN ('tr_role','tr_owner')
       AND (p.is_public_figure OR (p_include_private AND p.identity_confidence = 'verified'))
       AND e.person_id <> (SELECT person_id FROM subj)
  ),
  agg AS (
    SELECT rel.person_id,
           jsonb_agg(DISTINCT jsonb_build_object(
             'eik', rel.eik, 'name', cn.name, 'money', cn.public_money_eur)) AS companies,
           count(DISTINCT rel.eik) AS shared
      FROM rel JOIN graph_company_node cn ON cn.eik = rel.eik
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
    SELECT DISTINCT a.person_id AS p_id, e.eik
      FROM agg a
      JOIN graph_edge e ON e.person_id = a.person_id AND e.kind IN ('tr_role','tr_owner')
      JOIN graph_company_node cn ON cn.eik = e.eik
     WHERE e.eik NOT IN (SELECT eik FROM subj_co)
       AND (CASE WHEN p_include_private THEN cn.coowner_count ELSE cn.public_officer_count END) <= 6
  ),
  -- B on C2, excluding the subject, the direct connections, and P itself. One path per B.
  indirect AS (
    SELECT DISTINCT ON (e.person_id) e.person_id AS b_id, pc.p_id, pc.eik AS c2
      FROM p_co pc
      JOIN graph_edge e ON e.eik = pc.eik AND e.kind IN ('tr_role','tr_owner')
      JOIN person p ON p.person_id = e.person_id AND p.status = 'active'
     WHERE (p.is_public_figure OR (p_include_private AND p.identity_confidence = 'verified'))
       AND e.person_id <> (SELECT person_id FROM subj)
       AND e.person_id NOT IN (SELECT person_id FROM agg)
       AND e.person_id <> pc.p_id
     ORDER BY e.person_id, pc.eik
  )
  SELECT jsonb_build_object(
    'subject', (SELECT jsonb_build_object('slug', slug, 'name', name) FROM subj),
    -- DIRECT: A ─shared company─ B. `companies` carries the bridge company(ies), each with its money.
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
    -- INDIRECT: A → C1 → partner → C2 → B. Both hop companies carry money.
    'indirect', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'slug', pb.slug, 'name', pb.display_name,
        'party', pty.party_nick, 'partyColor', pty.party_color,
        'partnerSlug', pp.slug, 'partnerName', pp.display_name,
        'c1', jsonb_build_object('eik', pc1.c1, 'name', cc1.name, 'money', cc1.public_money_eur),
        'c2', jsonb_build_object('eik', i.c2, 'name', cc2.name, 'money', cc2.public_money_eur)
      ) ORDER BY pb.display_name)
      FROM indirect i
      JOIN person pb ON pb.person_id = i.b_id
      JOIN person pp ON pp.person_id = i.p_id
      JOIN p_c1 pc1 ON pc1.p_id = i.p_id
      LEFT JOIN graph_company_node cc1 ON cc1.eik = pc1.c1
      LEFT JOIN graph_company_node cc2 ON cc2.eik = i.c2
      LEFT JOIN LATERAL (
        SELECT party_nick, party_color FROM person_election_stats pes
         WHERE pes.person_id = pb.person_id AND pes.party_nick IS NOT NULL
         ORDER BY pes.election_date DESC LIMIT 1) pty ON true
    ), '[]'::jsonb),
    'disclaimer', 'Връзките са по съвпадение на име и обща фирма — насока, не категорично доказателство.'
  )
  FROM subj;
$$;

-- ── EGO: one person's immediate neighbourhood as nodes + typed edges, for the graph-ego route and the
-- /connections per-person mini. Unlike person_connections (person↔person, co-ownership only), this
-- returns the person↔COMPANY star across ALL edge kinds (co-ownership AND procurement), each company
-- with its public money, so the UI can draw the money-weighted ego graph. Same eligibility + toggle.
CREATE OR REPLACE FUNCTION person_graph_ego(p_slug text, p_include_private boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  -- Subject gated LIVE on person (same contract as person_connections), and selected FROM person so an
  -- eligible person with NO graph edges still returns a payload (empty companies/edges) rather than
  -- NULL — matching person_connections' shape. facet/money/degree are the graph node's denormalized
  -- display fields, LEFT-joined (NULL/0 for a zero-edge subject absent from graph_person_node).
  WITH subj AS (
    SELECT pr.person_id, pr.slug, pr.display_name AS name,
           g.facet, coalesce(g.public_money_eur, 0) AS public_money_eur, coalesce(g.degree, 0) AS degree
      FROM person pr
      LEFT JOIN graph_person_node g ON g.person_id = pr.person_id
     WHERE pr.slug = p_slug AND pr.status = 'active'
       AND (pr.is_public_figure OR (p_include_private AND pr.identity_confidence = 'verified'))
     LIMIT 1
  ),
  ego_edges AS (
    SELECT e.eik, e.kind, e.role, e.is_current, cn.name, cn.public_money_eur, cn.public_officer_count
      FROM graph_edge e
      JOIN subj ON subj.person_id = e.person_id
      JOIN graph_company_node cn ON cn.eik = e.eik
  )
  SELECT jsonb_build_object(
    'subject', (SELECT jsonb_build_object(
       'slug', slug, 'name', name, 'facet', facet,
       'money', public_money_eur, 'degree', degree) FROM subj),
    'companies', COALESCE((
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
        'eik', eik, 'name', name, 'money', public_money_eur,
        'officers', public_officer_count))
      FROM ego_edges), '[]'::jsonb),
    'edges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'eik', eik, 'kind', kind, 'role', role, 'current', is_current)
        ORDER BY eik, kind, role)
      FROM ego_edges), '[]'::jsonb),
    'disclaimer', 'Връзките са по съвпадение на име и обща фирма — насока, не категорично доказателство.'
  )
  FROM subj;
$$;
