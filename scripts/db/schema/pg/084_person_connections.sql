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
--     than MAX_CO_OFFICERS (6) public officers. Measured 2026-07-31: keeps 1,882 real ties,
--     excludes 73 mass-membership orgs.
--   • The identity disclaimer is baked into the payload so a consumer (page or narration)
--     can never drop it.

-- The association-noise guard's input, as a PER-COMPANY lookup.
--
-- NAME: it counts PUBLIC FIGURES, not officers. "Officer" elsewhere in this database
-- (tr_officers, company_officers(), search_officers()) means an actual TR-filed company
-- officer; this counts only those who are ALSO in the identity layer as
-- is_public_figure + status='active' — a small subset. Do not reuse it as an officer count.
--
-- This used to be a `co` CTE inside person_connections: one GROUP BY over every tr/ngo
-- person_role row joined to every person, building the officer count for all 18,278
-- companies — on every request, and entirely INDEPENDENT of the subject. It was 6,737 of
-- the function's 6,984 buffers (96.5%) and 60 ms of its 66 ms, and because a CTE referenced
-- twice is materialized, a person with NO companies at all paid the whole thing: 7,294
-- buffers to return an empty graph. That is the shape the traffic actually has — the load is
-- a crawler walking /person/{slug} alphabetically, so the common case was the expensive one,
-- and the route reached 8.2-10.1 s on prod (one request over the 10 s statement_timeout).
--
-- Only ~19-38 companies are ever consulted per request, so the count is computed per eik
-- instead, riding idx_person_role_source_ref (source, ref) + person_pkey. Measured with
-- plan_cache_mode = force_generic_plan, which is how a SQL function's parameter actually
-- plans (a literal lets the planner constant-fold what a parameter cannot):
--
--   no companies (the crawler's common case)  7,294 -> 560 buffers, 66 ms -> 1.6 ms
--   heaviest real subject in the corpus       8,242 -> 2,160 buffers, 66 ms -> 3.7 ms
--
-- (Hand-inlining the body drops the first case to 19 buffers on a pure index path — measured,
-- and the proof no seq scan survives, but NOT what ships: the function is deliberately kept
-- separate, see below. The gate measures the shipped path a third way, through the pool, and
-- reads 38 — three methods, three numbers, all of the same change.)
--
-- Kept as ONE function, not inlined at its two call sites, so MAX_CO_OFFICERS (6) and the
-- public-figure/active gate stay single-sourced exactly as the `co` CTE kept them.
--
-- TWO SUBTLETIES, since both look like behaviour changes and neither is. The old `co` was
-- joined with an INNER JOIN, so an eik absent from the map was DROPPED. A scalar count keeps
-- such an eik instead, and there are two ways to be absent:
--
--   1. A company with NO public+active officer counts 0, and 0 <= 6 would keep it. Neither
--      call site can reach that eik: both start from a person who is themselves public+active
--      (`subj` enforces it for subj_co, `rel`/`agg` for p_co), and that person's own role
--      contributes to the count, so every candidate eik has a count >= 1 by construction.
--   2. A NULL ref never matched `co.eik = r.ref`. STRICT is what closes this one — it makes
--      the call return NULL, `NULL <= 6` is NULL, and the row is filtered out, reproducing the
--      INNER JOIN exactly. person_role.ref is NOT NULL today, so this is belt-and-braces; the
--      point is that it holds STRUCTURALLY rather than by relying on that constraint.
--
-- Verified rather than argued: 16,103 subjects compared old vs new, 0 mismatches (§3 of
-- docs/plans/person-connections-scan-v1.md).
--
-- COST 500 IS LOAD-BEARING, NOT COSMETIC. order_qual_clauses() sorts a scan's quals by
-- per-tuple cost, and that is the ONLY thing keeping `source IN ('tr','ngo')` ahead of this
-- call at both sites. Lowering it (the plausible "the planner over-costs my cheap index
-- lookup" tweak) lets a person with many non-TR roles pay one lookup PER ROLE. It is set
-- explicitly rather than left at the LANGUAGE sql default of 100 so the dependency is visible
-- to whoever considers changing it; `person_connections.data.test.ts` asserts the ordering.
CREATE OR REPLACE FUNCTION public_officer_count(p_eik text)
RETURNS bigint LANGUAGE sql STABLE STRICT PARALLEL SAFE COST 500 AS $$
  SELECT count(DISTINCT r.person_id)
    FROM person_role r JOIN person p USING (person_id)
   WHERE r.source IN ('tr','ngo') AND r.ref = p_eik
     AND p.is_public_figure AND p.status = 'active';
$$;

CREATE OR REPLACE FUNCTION person_connections(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH subj AS (
    SELECT person_id, slug, display_name FROM person
     WHERE slug = p_slug AND status = 'active' AND is_public_figure
     LIMIT 1
  ),
  -- the subject's own companies that are small enough to be a real tie (<= 6 officers).
  -- The `source IN (...)` filter is cheap and selective, so the planner applies it before
  -- public_officer_count (see the COST note above) — verified on the person with the most
  -- NON-tr roles in the corpus (24 of them, 0 tr/ngo): the function is never called, and the
  -- query costs the same 38 buffers as a person with no roles at all. The same ordering holds
  -- at p_co below, where the identical filter sits in a JOIN ... ON rather than a WHERE; the
  -- planner treats the two alike.
  subj_co AS (
    SELECT DISTINCT r.ref AS eik
      FROM person_role r
      JOIN subj ON subj.person_id = r.person_id
     WHERE r.source IN ('tr','ngo')
       AND public_officer_count(r.ref) <= 6
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
     WHERE r.ref NOT IN (SELECT eik FROM subj_co)
       AND public_officer_count(r.ref) <= 6
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
