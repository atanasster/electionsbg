-- 099_person_slug_lock.sql — stable /person/:slug URLs across re-resolves.
--
-- The name-hash slug tier (a person who is neither an MP nor an official) was
-- kebab(name)-hash6(sorted member mention ids). That hash flips whenever the person's
-- CLUSTER drifts by even one mention — so each re-resolve reassigned ~a third of the
-- non-MP slugs, silently breaking bookmarked / shared /person links AND the browser-local
-- watchlist (which stores slugs, T3.10). It also made local and cloud disagree on ~35% of
-- slugs whenever their upstream data differed.
--
-- This table pins each member mention id to the slug of the person it belongs to, so a
-- person keeps their slug as long as they retain ANY previously-seen member. It is NOT
-- truncated by a resolve — it accumulates across runs. On the FIRST run against an empty
-- lock table every person keeps its currently-derived slug (the lock is seeded, nothing
-- changes); from then on the derived hash is only a fallback for a wholly new person.
--
-- MP / official slugs (mp-<id> / the officials ref) are already stable and are NOT locked
-- over — the lock anchors only the name-hash tier.
CREATE TABLE IF NOT EXISTS person_slug_lock (
  mention_id text PRIMARY KEY,
  slug       text NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now()
);

-- Reverse lookup (slug → its member mentions) for auditing / migration.
CREATE INDEX IF NOT EXISTS idx_person_slug_lock_slug ON person_slug_lock (slug);
