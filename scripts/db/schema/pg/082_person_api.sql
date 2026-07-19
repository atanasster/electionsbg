-- 082_person_api.sql — read-only serving functions over the resolved person tables
-- (081_person_identity.sql, populated by scripts/person/resolve_persons.ts). STABLE
-- jsonb functions, EXECUTE auto-granted to app_readonly via ALTER DEFAULT PRIVILEGES.
-- These back the future /api/db/person + personSearch AI tool (plan §4b, §4d). Idempotent.

-- One person's unified profile for /person/{slug}: identity + every role, each tagged
-- with its source facet + Bulgarian label (person_source, plan §5) so the Connections
-- component (§8) can drive its filter chips straight off `facets`. PUBLIC-SAFE: only
-- active, non-review-confidence roles are exposed (plan §3 public-surface rule).
DROP FUNCTION IF EXISTS person_by_slug(text);
CREATE OR REPLACE FUNCTION person_by_slug(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    -- §6 privacy gate: only PUBLIC figures get a public profile. A private person (e.g. a
    -- donor-only individual) is internal-only and must never be served, even by slug.
    SELECT * FROM person
     WHERE slug = p_slug AND status = 'active' AND is_public_figure LIMIT 1
  )
  SELECT jsonb_build_object(
    'slug', pick.slug,
    'name', pick.display_name,
    'namesakeRisk', pick.namesake_risk,
    'isPublicFigure', pick.is_public_figure,
    'facets', COALESCE((
      SELECT jsonb_agg(DISTINCT s.facet)
      FROM person_role r JOIN person_source s ON s.key = r.source
      WHERE r.person_id = pick.person_id
        AND r.confidence IN ('exact_id', 'high', 'manual')
    ), '[]'::jsonb),
    'roles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source', r.source, 'facet', s.facet, 'sourceLabel', s.label_bg,
        'role', r.role, 'ref', r.ref, 'place', r.place, 'confidence', r.confidence
      ) ORDER BY s.facet, r.role)
      FROM person_role r JOIN person_source s ON s.key = r.source
      WHERE r.person_id = pick.person_id
        AND r.confidence IN ('exact_id', 'high', 'manual')
    ), '[]'::jsonb),
    -- TR footprint resolved to NAMED companies (the bare EIK in `roles` is useless on a
    -- page). Each company carries every role the person holds there + its PUBLIC-CONTRACT
    -- take (Σ current_amount_eur, the post-annex basis, reference_procurement_eur_sum_basis)
    -- — the money thesis on the identity page. Bridged only — Bridge A (shared company) /
    -- Bridge B (unique full name) — so it is public-safe by §3/§6. Ordered money-first.
    'companies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'eik', tr.ref, 'name', c.name, 'legalForm', c.legal_form,
        'seat', c.seat, 'status', c.status, 'roles', tr.roles,
        'procuredEur', pr.eur, 'contracts', pr.n
      ) ORDER BY pr.eur DESC NULLS LAST, c.name NULLS LAST, tr.ref)
      FROM (
        SELECT r.ref, jsonb_agg(DISTINCT r.role ORDER BY r.role) AS roles
        FROM person_role r
        WHERE r.person_id = pick.person_id AND r.source = 'tr'
          AND r.confidence IN ('exact_id', 'high', 'manual')
        GROUP BY r.ref
      ) tr
      LEFT JOIN tr_companies c ON c.uic = tr.ref
      LEFT JOIN LATERAL (
        SELECT round(sum(ct.current_amount_eur)::numeric, 2) AS eur, count(*) AS n
        FROM contracts ct WHERE ct.contractor_eik = tr.ref
      ) pr ON pr.n > 0
    ), '[]'::jsonb),
    -- NGO board seats (ЮЛНЦ — associations / foundations / читалища), the `ngo` facet.
    -- Same bridge + public-safe rules as `companies`, but a civic board seat, not a
    -- business interest, so it renders in its own section (no procurement column).
    'ngos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'eik', ng.ref, 'name', c.name, 'legalForm', c.legal_form,
        'seat', c.seat, 'roles', ng.roles
      ) ORDER BY c.name NULLS LAST, ng.ref)
      FROM (
        SELECT r.ref, jsonb_agg(DISTINCT r.role ORDER BY r.role) AS roles
        FROM person_role r
        WHERE r.person_id = pick.person_id AND r.source = 'ngo'
          AND r.confidence IN ('exact_id', 'high', 'manual')
        GROUP BY r.ref
      ) ng LEFT JOIN tr_companies c ON c.uic = ng.ref
    ), '[]'::jsonb),
    -- The person's total public-contract take across ALL their companies (EIK-deduped so a
    -- manager+owner double role can't double-count).
    'procuredEur', COALESCE((
      SELECT round(sum(x.eur)::numeric, 2) FROM (
        SELECT (SELECT sum(current_amount_eur) FROM contracts WHERE contractor_eik = r.ref) AS eur
        FROM person_role r
        WHERE r.person_id = pick.person_id AND r.source = 'tr'
          AND r.confidence IN ('exact_id', 'high', 'manual')  -- match the companies filter
        GROUP BY r.ref
      ) x
    ), 0),
    -- Official sanctions designations (OFAC/EU), with their provenance from source_row —
    -- rendered as a prominent, CITED badge (these are government findings, not our claim).
    'sanctions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'program', r.source_row->>'program',
        'authority', r.source_row->>'authority',
        'date', r.source_row->>'date',
        'url', r.source_row->>'url'
      ) ORDER BY r.source_row->>'date' DESC)
      FROM person_role r
      WHERE r.person_id = pick.person_id AND r.source = 'sanctions'
        AND r.confidence IN ('exact_id', 'high', 'manual')
    ), '[]'::jsonb),
    -- ДС / COMDOS affiliations (Комисия по досиетата) — official state findings, cited to
    -- their решение № + date, rendered as a prominent CITED badge (a government verdict,
    -- not our claim). Same public-safe gate as sanctions (attached only via the MP gold key).
    'ds', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'decisionNo', r.source_row->>'decisionNo',
        'decisionDate', r.source_row->>'decisionDate',
        'body', r.source_row->>'bodyContext',
        'category', r.source_row->>'category',
        'pseudonyms', COALESCE(r.source_row->'pseudonyms', '[]'::jsonb),
        'url', r.source_row->>'url'
      ) ORDER BY r.source_row->>'decisionDate' DESC)
      FROM person_role r
      WHERE r.person_id = pick.person_id AND r.source = 'ds'
        AND r.confidence IN ('exact_id', 'high', 'manual')
    ), '[]'::jsonb),
    -- Alternate surface forms that fold to this person (spelling / transliteration
    -- variants across sources), for display + so a search hit on any of them makes sense.
    'aliases', COALESCE((
      SELECT jsonb_agg(DISTINCT a.alias_raw)
      FROM person_alias a
      WHERE a.person_id = pick.person_id AND a.alias_raw <> pick.display_name
    ), '[]'::jsonb)
  )
  FROM pick;
$$;

-- Resolve a bare NAME to its profile — but only when the folded name maps to exactly ONE
-- active person (no namesake ambiguity). Lets the legacy /person/{name} links (magistrate
-- holdings, associates, connection checks) land on the unified profile; a 0- or >1-match
-- name returns NULL so the caller falls back to the legacy portfolio / a chooser.
-- A fuzzy index over the alternate name forms so name-resolution + search can match a
-- variant spelling (marriage / transliteration) that only appears in person_alias.
CREATE INDEX IF NOT EXISTS idx_person_alias_fold_trgm
  ON person_alias USING gin (alias_fold gin_trgm_ops);

DROP FUNCTION IF EXISTS person_by_name(text);
CREATE OR REPLACE FUNCTION person_by_name(p_name text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH f AS (SELECT translit_bg_latin(p_name) AS fold),
  m AS (
    -- Match the display name OR any alias fold, so a person known under a variant spelling
    -- still resolves (idx_person_alias_fold is exact-keyed → fast).
    SELECT DISTINCT p.slug FROM person p, f
     WHERE p.status = 'active' AND p.is_public_figure   -- §6 privacy gate
       AND (p.name_fold = f.fold
            OR EXISTS (SELECT 1 FROM person_alias a
                        WHERE a.person_id = p.person_id AND a.alias_fold = f.fold))
     LIMIT 2
  )
  SELECT CASE WHEN (SELECT count(*) FROM m) = 1
    THEN person_by_slug((SELECT slug FROM m LIMIT 1)) END;
$$;

-- Name search for personSearch / the arbitrary-person lookup. Folds the query with the
-- ONE normalizer and ranks by trigram similarity over name_fold (GIN gin_trgm_ops index,
-- 081). Returns the namesake_risk so the caller can show the "name match — identity not
-- verified" weighting. Only active persons; review-status persons stay internal.
DROP FUNCTION IF EXISTS person_search(text, int);
CREATE OR REPLACE FUNCTION person_search(p_q text, p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH q AS (SELECT translit_bg_latin(p_q) AS f),
  -- Candidate persons: a trigram/substring hit on the display name OR any ALIAS (variant
  -- spelling). Both sides ride a GIN trigram index (name_fold + idx_person_alias_fold_trgm),
  -- so this stays fast even on a common surname.
  cand AS (
    SELECT DISTINCT p.person_id
    FROM person p, q
    WHERE p.status = 'active' AND p.is_public_figure   -- §6 privacy gate
      AND length(q.f) >= 2
      AND (p.name_fold % q.f OR p.name_fold LIKE '%' || q.f || '%')
    UNION
    SELECT DISTINCT a.person_id
    FROM person_alias a
    JOIN person p2 ON p2.person_id = a.person_id
    CROSS JOIN q
    WHERE p2.status = 'active' AND p2.is_public_figure
      AND length(q.f) >= 2 AND a.alias_fold % q.f
  ),
  scored AS (
    -- Aliased persons SURFACE (via `cand`); ranking is by display-name closeness (an
    -- alias-only hit scores low but still appears — enough for the lookup, and cheap).
    SELECT p.person_id, p.slug, p.display_name, p.namesake_risk,
           similarity(p.name_fold, q.f) AS score
    FROM cand JOIN person p USING (person_id), q
    ORDER BY score DESC, p.slug
    LIMIT GREATEST(p_limit, 1)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'slug', s.slug, 'name', s.display_name, 'namesakeRisk', s.namesake_risk,
    'roles', (SELECT count(*) FROM person_role r WHERE r.person_id = s.person_id),
    'score', round(s.score::numeric, 3)
  ) ORDER BY s.score DESC, s.display_name), '[]'::jsonb)
  FROM scored s;
$$;
