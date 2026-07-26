-- 106_officials_redirect.sql — resolve an /officials/<slug> URL to the /person/<slug> that
-- replaced it, for the 301 served by the `db` Cloud Function.
--
-- Plan: docs/plans/persons-pg-retirement-v1.md (T1.1). Decision 1: OfficialProfileScreen is
-- retired and PersonDashboard becomes the single person surface, so every /officials/<slug>
-- URL — indexed, bookmarked, linked from elsewhere — has to land somewhere.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS A FUNCTION AND NOT A firebase.json REDIRECT RULE.
--
-- The two slug spaces do not line up. An officials slug is minted by
-- officialSlug(name, institution) with an INSTITUTION disambiguator
-- (scripts/officials/shared.ts); a person slug is a separate space with its own uniqueness
-- rule (resolve_persons.ts). So `/officials/ivan-petrov-mvr` -> `/person/ivan-petrov` is not
-- expressible as a glob capture, and enumerating the ~20.9k pairs exceeds Firebase's
-- 1,000-redirect-per-site limit by 20×.
--
-- The trap is that they line up ALMOST always. Measured 2026-07-25 (T0.1): 18,508 of 20,658
-- officials refs (89.6%) already equal their person slug, so a naive glob rewrite would
-- appear to work while silently 301ing the remaining 2,150 (10.4%) to a wrong or
-- non-existent /person URL. Partial alignment is the hazard, not the fix.
--
-- ---------------------------------------------------------------------------
-- TWO LOOKUPS, IN THIS ORDER, AND THE ORDER IS LOAD-BEARING.
--
--   1. person_role.ref — the officials slug as it exists TODAY. This is the common case and
--      it must win, because it names the person who currently holds that post.
--   2. person_slug_redirect() — the slug is RETIRED: either a merge collapsed it (T1.4a) or
--      the officials ingest re-slugged it (T1.0, 18,428 of them). Consulted second because
--      person_slug_redirect() deliberately refuses to answer for a slug that is still live,
--      so asking it first would just return NULL for every current official.
--
-- Both are already §6-gated, and this fn does not re-gate: a redirect to a page we would
-- refuse to serve is a 404 with extra steps, so an unresolvable slug returns NULL and the
-- caller 404s honestly rather than bouncing the reader somewhere plausible.
--
-- STABLE + read-only, so it runs under app_readonly like every other serving fn (082).
DROP FUNCTION IF EXISTS officials_person_slug(text);
CREATE OR REPLACE FUNCTION officials_person_slug(p_slug text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT p.slug
       FROM person_role r
       JOIN person p ON p.person_id = r.person_id
                    -- §6 privacy gate, as in every serving fn (082, 100).
                    AND p.status = 'active' AND p.is_public_figure
      WHERE r.ref = p_slug
        -- The shared definition of "a person_role.ref that is a URL" (103). NOT a
        -- `LIKE 'official%'` prefix test: president / mep / diplomat are Court-of-Audit
        -- officials whose source names do not start with "official", and a prefix test
        -- cost 179 people their roles section the last time one was used
        -- (src/lib/officialSources.ts records it).
        AND r.source = ANY(person_officials_sources())
      ORDER BY p.person_id
      LIMIT 1),
    person_slug_redirect(p_slug)
  );
$$;
