-- 103_person_slug_retired.sql — where a retired /person slug went.
--
-- Plan: docs/plans/persons-pg-retirement-v1.md (T1.4a, prerequisite for T1.4).
--
-- WHY. 099 keeps a person's slug stable while their cluster drifts, but it cannot help when
-- two persons MERGE: one slug survives and the other stops existing. T0.1b merged 154 person
-- rows in a single run — every one of those 154 /person/<slug> URLs began returning a 404,
-- and 099's lock is keyed on mention_id, so it records where a mention went but not that the
-- slug it used to serve is now dead.
--
-- That was harmless only because /person is not yet prerendered or sitemapped. T1.4 changes
-- exactly that. Once those URLs are indexed, bookmarked and sitting in the browser-local
-- watchlist (which stores slugs, T3.10), the NEXT merge silently 404s indexed pages — the
-- precise failure 099 exists to prevent, one level up. So the mapping has to exist before
-- /person is published, not after.
--
-- WHAT IT IS. slug -> the person that slug's mentions now belong to. Written by
-- db:resolve:persons, which is the only thing that knows both sides: it holds the previous
-- lock (the old slug per mention) in memory at the moment it computes the new one.
--
-- NOT TRUNCATED, like 099. A slug retired three runs ago must keep redirecting; forgetting
-- it is the same 404. But it IS recomputed in full every run, from the lock, so a chain
-- (A merges into B, later B merges into C) always resolves to the FINAL person rather than
-- to a middle link that is itself dead — no recursive lookup is needed at read time.
--
-- A slug is only recorded here when it is genuinely gone: a slug that still belongs to a
-- live person is never a redirect, or a person would 301 to themselves.

CREATE TABLE IF NOT EXISTS person_slug_retired (
  slug        text PRIMARY KEY,
  -- The slug to send the reader to. Always a live person.slug at write time.
  target_slug text NOT NULL,
  retired_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_person_slug_retired_target
  ON person_slug_retired (target_slug);

-- Resolve a /person slug that no longer exists to the one that replaced it. Returns NULL
-- when the slug is unknown OR still live — callers must try the live person FIRST and only
-- fall back here, so a live page is never turned into a redirect.
--
-- STABLE + read-only, so it runs under app_readonly like every other serving fn (082).
CREATE OR REPLACE FUNCTION person_slug_redirect(p_slug text)
RETURNS text
LANGUAGE sql STABLE AS $$
  -- FOLLOWS THE CHAIN. A merges into B, then later B merges into C: the stored row for A
  -- still says B, because the resolver computes retirements by diffing the slug lock and
  -- that lock is destructively overwritten each run — A's mentions are never revisited once
  -- they stop moving, so nothing rewrites A→C. Resolving the chain at READ time makes that
  -- irrelevant and costs one indexed hop per link.
  --
  -- The depth cap is a cycle guard, not a business rule: a bad merge/split pair could point
  -- two slugs at each other, and an uncapped walk would spin inside a serving function.
  WITH RECURSIVE hop(slug, target_slug, depth) AS (
    SELECT r.slug, r.target_slug, 1
      FROM person_slug_retired r
     WHERE r.slug = p_slug
       -- Never redirect away from a slug that is currently served.
       AND NOT EXISTS (SELECT 1 FROM person p WHERE p.slug = p_slug)
    UNION ALL
    SELECT r.slug, r.target_slug, h.depth + 1
      FROM hop h
      JOIN person_slug_retired r ON r.slug = h.target_slug
     WHERE h.depth < 8
  )
  SELECT h.target_slug
    FROM hop h
   WHERE EXISTS (
     -- The target must be a person the profile route will actually SERVE. Existence alone
     -- is too weak: 082 gates every person read on status='active' AND is_public_figure,
     -- and 1,283 rows fail that — redirecting into one is a 301 into a 404.
     SELECT 1 FROM person p
      WHERE p.slug = h.target_slug
        AND p.status = 'active'
        AND p.is_public_figure)
   ORDER BY h.depth DESC
   LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- BACKFILL for slugs retired BEFORE this table existed (the 154 that T0.1b merged).
--
-- The resolver computes retirements by diffing the slug lock, but that lock was already
-- overwritten by the run that did the merging, so those 154 are not recoverable that way.
-- They ARE recoverable exactly, without guessing: an officials `person_role.ref` IS the
-- officials slug, and when two person rows merge the losing ref survives on the winning
-- person. So a ref that is no longer any person's slug, on a person who has one, names
-- precisely the retired slug and where it went — e.g. ahmed-mehmed-ahmed-a98e30 is not a
-- live person but its role sits on ahmed-mehmed-ahmed-a0c2ec.
--
-- Restricted to refs that are actually SLUGS. `mp` refs are numeric ids, `candidate` refs
-- are '{election}:mp-{id}', and `magistrate` refs are the declarant's Cyrillic NAME — none
-- was ever a URL, and seeding them put 3,113 names like "Мария Венциславова Милушева" into
-- a redirect table. The shape guard is the mint format of officialSlug(): a latin kebab
-- stem plus a 6-hex disambiguator.
--
-- This is deliberately a SUPERSET of "slugs that once served a /person page": it also holds
-- officials slugs that never did, because the question the table answers is "this slug does
-- not resolve to a person — where should the reader go?", and for both kinds the honest
-- answer is the same person. person_slug_redirect() only fires when the slug is not live,
-- so a wider seed cannot shadow a real page.
--
-- Idempotent, and it defers to whatever the resolver later writes (that path upserts).
INSERT INTO person_slug_retired (slug, target_slug)
SELECT DISTINCT r.ref, p.slug
  FROM person_role r
  JOIN person p ON p.person_id = r.person_id
 WHERE r.source IN ('official_exec', 'official_muni', 'public_sector',
                    'president', 'mep', 'diplomat')
   AND r.ref <> p.slug
   AND r.ref ~ '^[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{6}$'
   AND NOT EXISTS (SELECT 1 FROM person p2 WHERE p2.slug = r.ref)
ON CONFLICT (slug) DO NOTHING;
