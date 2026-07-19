-- 085_person_elections.sql — the candidate → person_id bridge and the electoral
-- dashboard data re-keyed by person_id (person-candidate-merge-v1).
--
-- WHY: the electoral shards under data/{election}/candidates/{NAME}/ are keyed by the
-- candidate's display NAME, so two same-name candidates in one election collide into one
-- folder (21 in 2026_04_19 alone — save_preferences.ts keys the output dir by name). The
-- by-slug shards (c-{party}-{slug}) stay party-separated. These tables re-key the electoral
-- summary by the stable person_id (disambiguating collisions by party), so /person/{slug}
-- and /candidate/{id} render one person's whole electoral arc without the namesake bug.
--
-- Populated by scripts/db/load_person_elections_pg.ts, which runs AFTER
-- scripts/person/resolve_persons.ts (it needs the person_id assignments). Idempotent
-- CREATE … IF NOT EXISTS so a fresh clone / db:refresh rebuilds from empty.

-- candidate URL (or bare name) → the owning person. The slug path is already party-unique
-- (the slug embeds partyNum); the name path disambiguates same-name politicians by party.
CREATE TABLE IF NOT EXISTS candidate_person (
  election_date        text   NOT NULL,   -- 'YYYY_MM_DD' folder form (== frontend `selected`)
  candidate_slug       text   NOT NULL,   -- c-{party}-{nameSlug} | mp-{id}
  candidate_name_fold  text   NOT NULL,   -- translit_bg_latin(candidate display name)
  party_num            int,               -- NULL only for a party-less legacy row
  person_id            bigint NOT NULL,
  person_slug          text   NOT NULL,
  PRIMARY KEY (election_date, candidate_slug)
);
CREATE INDEX IF NOT EXISTS idx_candidate_person_name
  ON candidate_person (candidate_name_fold, party_num);
CREATE INDEX IF NOT EXISTS idx_candidate_person_slug   ON candidate_person (candidate_slug);
CREATE INDEX IF NOT EXISTS idx_candidate_person_person ON candidate_person (person_id);

-- One person's electoral summary for one election, re-keyed off the name-folder shards.
-- The jsonb columns are the RAW shard arrays (regions.json + the three preferences_stats
-- fields), so the SAME frontend reducer (was useCandidateSummary) runs over them unchanged —
-- the migration is a faithful re-key, not a recompute. A person runs on ONE party per
-- election, so (person_id, election_date) is the natural key; party_num is a plain column
-- (a seated MP that resolves from both its mp-{id} and c-{party} shard is deduped to the
-- authoritative slug-party row in the loader, not split into two PK rows).
CREATE TABLE IF NOT EXISTS person_election_stats (
  person_id       bigint NOT NULL,
  election_date   text   NOT NULL,
  party_num       int    NOT NULL DEFAULT 0,
  total_votes     int    NOT NULL DEFAULT 0,   -- Σ regions[].totalVotes (denormalized for sort)
  regions         jsonb  NOT NULL DEFAULT '[]'::jsonb,   -- regions.json (PreferencesInfo[])
  stats           jsonb  NOT NULL DEFAULT '[]'::jsonb,   -- preferences_stats.stats (history)
  top_settlements jsonb  NOT NULL DEFAULT '[]'::jsonb,
  top_sections    jsonb  NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (person_id, election_date)
);
CREATE INDEX IF NOT EXISTS idx_person_election_stats_person
  ON person_election_stats (person_id);

-- ── serving functions ──────────────────────────────────────────────────────────────────
-- All gate on the §6 privacy rule (active + public figure), consistent with person_by_slug.

-- Every election row for one person (newest first) → the electoral block on /person/{slug}.
-- The caller picks the globally-selected cycle and runs the existing reducer over `regions` +
-- the preferences_stats fields.
DROP FUNCTION IF EXISTS person_elections(text);
CREATE OR REPLACE FUNCTION person_elections(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    SELECT person_id FROM person
     WHERE slug = p_slug AND status = 'active' AND is_public_figure LIMIT 1
  )
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'election', e.election_date,
      'partyNum', e.party_num,
      'totalVotes', e.total_votes,
      'regions', e.regions,
      'history', e.stats,
      'topSettlements', e.top_settlements,
      'topSections', e.top_sections
    ) ORDER BY e.election_date DESC)
    FROM person_election_stats e, pick
    WHERE e.person_id = pick.person_id
  ), '[]'::jsonb);
$$;

-- Resolve a candidate slug (c-{party}-… | mp-{id}) to its owning person's slug, election-
-- agnostic (a slug maps to exactly one person across the cycles it appears in). Gated to a
-- public+active person; NULL when unknown or private, so /candidate/{id} falls through to the
-- legacy candidate render.
DROP FUNCTION IF EXISTS candidate_person_slug(text);
CREATE OR REPLACE FUNCTION candidate_person_slug(p_slug text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT cp.person_slug
    FROM candidate_person cp
    JOIN person p ON p.slug = cp.person_slug
   WHERE cp.candidate_slug = p_slug
     AND p.status = 'active' AND p.is_public_figure
   ORDER BY cp.election_date DESC
   LIMIT 1;
$$;

-- Resolve a bare candidate NAME (+ optional party) to a person slug, for the legacy
-- name-form candidate URLs. Party disambiguates same-name politicians; without a party a
-- name that folds to more than one person returns NULL (caller shows the namesake chooser).
DROP FUNCTION IF EXISTS candidate_person_by_name(text, int);
CREATE OR REPLACE FUNCTION candidate_person_by_name(p_name text, p_party int DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE AS $$
  WITH f AS (SELECT translit_bg_latin(p_name) AS fold),
  m AS (
    SELECT DISTINCT cp.person_slug
      FROM candidate_person cp
      JOIN person p ON p.slug = cp.person_slug, f
     WHERE cp.candidate_name_fold = f.fold
       AND (p_party IS NULL OR cp.party_num = p_party)
       AND p.status = 'active' AND p.is_public_figure
     LIMIT 2
  )
  SELECT CASE WHEN (SELECT count(*) FROM m) = 1
    THEN (SELECT person_slug FROM m LIMIT 1) END;
$$;
