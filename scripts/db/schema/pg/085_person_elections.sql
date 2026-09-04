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
  -- Party DISPLAY (nickName + colour) resolved from that election's cik_parties.json at load
  -- time — (election, party_num)→party is election-specific and the colour/nick live only in
  -- per-election JSON, so baking them here lets person_search show a correct party badge
  -- without the client re-loading every candidacy's election. NULL for a party-less row.
  party_nick      text,
  party_color     text,
  total_votes     int    NOT NULL DEFAULT 0,   -- Σ regions[].totalVotes (denormalized for sort)
  regions         jsonb  NOT NULL DEFAULT '[]'::jsonb,   -- regions.json (PreferencesInfo[])
  stats           jsonb  NOT NULL DEFAULT '[]'::jsonb,   -- preferences_stats.stats (history)
  top_settlements jsonb  NOT NULL DEFAULT '[]'::jsonb,
  top_sections    jsonb  NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (person_id, election_date)
);
-- Back-compat for an already-migrated DB (the CREATE TABLE above no-ops via IF NOT EXISTS).
ALTER TABLE person_election_stats ADD COLUMN IF NOT EXISTS party_nick  text;
ALTER TABLE person_election_stats ADD COLUMN IF NOT EXISTS party_color text;
CREATE INDEX IF NOT EXISTS idx_person_election_stats_person
  ON person_election_stats (person_id);

-- ── serving functions ──────────────────────────────────────────────────────────────────
-- All gate on `status = 'active' AND is_public_figure`. ⚠️ That is NARROWER than
-- person_by_slug's `is_public_figure OR identity_confidence IN ('verified','shared_name')`,
-- deliberately: the narrower gate is what makes every namesake-chooser row a page that
-- actually serves. The cost is that a verified-but-not-public person would be unreachable
-- from a bare-name candidate URL and absent from the chooser — 0 such people among
-- candidate_person as of 2026-09-04, so re-measure before relying on that.

-- Every election row for one person (newest first) → the electoral block on /person/{slug}.
-- The caller picks the globally-selected cycle and runs the existing reducer over `regions` +
-- the preferences_stats fields.
--
-- ⚠️⚠️ `history` IS DERIVED FROM THE PERSON'S OWN ROWS, NOT from the `stats` column beside
-- them, and that is a CORRECTNESS fix rather than a tidy-up
-- (docs/plans/person-candidate-display-unification-v1.md §2).
--
-- `person_election_stats.stats` is the raw `preferences_stats.json` array copied out of the
-- NAME folder, and that array accumulates the fold's history across every cycle. The
-- loader's collision guard (`load_person_elections_pg.ts` → `candidacyRegions`.isCollision)
-- is `distinctParties.size > 1` WITHIN ONE election folder, so a namesake who ran in a
-- DIFFERENT cycle is invisible to it and their bar passes straight onto this person's chart.
-- Measured 2026-09-03 over every person's trajectory: of 55,046 bars drawn, 5,111 (2,458
-- people) were cycles the person has no row for — and 5,111 of those 5,111 are explained by
-- a same-name candidate in that cycle belonging to a different person_id. 100%.
--
-- The person's own arc is fully recoverable from their own rows, so the fix costs no new
-- data and no reload: `party_nick`/`party_color` and `regions[].{oblast, pref, totalVotes}`
-- reproduce the shard's own entries exactly (verified against person 6461, 2024_10_27 →
-- S24/116/18 and 2022_10_02 → S24/111/76).
--
-- Consequences, stated because most of them are a REDUCTION and that is correct: 5,111 wrong
-- bars go, 367 currently-missing ones appear (300 people whose `stats` the collision guard
-- had nulled, so they had no trajectory at all), and 1,906 people LOSE the tile entirely —
-- their only second bar was a namesake's, and a candidate who ran once has no trajectory.
--
-- The arc is the person's WHOLE career and is therefore identical on every row. It is
-- repeated per row rather than hoisted because the payload is an ARRAY of rows and a
-- consumer reading `rows[k].history` must not get an empty one — the duplication is not new,
-- since `stats` was per-row too.
--
-- Measured 2026-09-04 over all 29,715 public people: the payload SHRINKS on average — 7,300
-- → 6,896 bytes (−5.5%), 216.9 MB → 204.9 MB corpus-wide, 26,862 of 29,715 smaller — because
-- the shard array carried one entry per election in the corpus and most were EMPTY, while an
-- arc entry is populated by construction. The WORST case grows: the 10-candidacy maximum went
-- 67,280 → 73,001 bytes (+8.5%), which is where the per-row repetition shows. Costed and
-- accepted either way — the alternative is a chart that draws other people's cycles.
--
-- The `::int` cast on `totalVotes` is the ONE way this function can now raise. 0 of 59,717
-- region elements carry a non-integer value today, and an ABSENT key is safe (`->>` yields
-- NULL, `NULL::int` is NULL, and DESC NULLS LAST already handles it) — but `regions` is
-- stored verbatim from the shard by a deliberately permissive reader (candidateRegions.ts),
-- and `missingMigrationEmpty` degrades only 42883/42P01, so one malformed value would be a
-- 500 on the whole electoral block rather than a missing chart.
--
-- ⚠️ The `stats` COLUMN is deliberately left in place and the loader is unchanged. Nothing on
-- the serving path reads it any more (verified 2026-09-04: no function, view or matview
-- references it), and it is kept for two reasons — it is the verbatim shard capture, and it
-- is the only in-database EVIDENCE that the pollution existed, which the sentinel gate in
-- person_elections.data.test.ts measures and the shard-fidelity gate compares against.
-- `top_settlements` / `top_sections` are SEPARATE columns fed by separate shard fields and do
-- not depend on it. Do not "fix" the derivation back to it.
DROP FUNCTION IF EXISTS person_elections(text);
CREATE OR REPLACE FUNCTION person_elections(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH pick AS (
    SELECT person_id FROM person
     WHERE slug = p_slug AND status = 'active' AND is_public_figure LIMIT 1
  ),
  own AS (
    SELECT e.* FROM person_election_stats e, pick WHERE e.person_id = pick.person_id
  ),
  -- One entry per cycle the person ACTUALLY has results for. A row with no regions is a
  -- roster-only candidacy: the chart filters empty `preferences` out anyway, so including it
  -- would only inflate `history.length` past the ≥2 the tile needs to draw.
  arc AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'elections_date', o.election_date,
             'party', CASE WHEN o.party_nick IS NOT NULL
                             THEN jsonb_build_object('nickName', o.party_nick,
                                                     'color', o.party_color) END,
             'preferences', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object(
                          'oblast', x->>'oblast',
                          'pref', x->>'pref',
                          'preferences', (x->>'totalVotes')::int
                        ) ORDER BY (x->>'totalVotes')::int DESC NULLS LAST, x->>'oblast')
                   FROM jsonb_array_elements(o.regions) x
               ), '[]'::jsonb)
           ) ORDER BY o.election_date), '[]'::jsonb) AS h
      FROM own o
     WHERE jsonb_array_length(o.regions) > 0
  )
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'election', o.election_date,
      'partyNum', o.party_num,
      'totalVotes', o.total_votes,
      'regions', o.regions,
      'history', (SELECT h FROM arc),
      'topSettlements', o.top_settlements,
      'topSections', o.top_sections
    ) ORDER BY o.election_date DESC)
    FROM own o
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

-- Resolve a bare candidate NAME to the ONE person it means, using the two disambiguators
-- the page can supply. (person-candidate-display-unification-v1 Tier 1.)
--
-- WHY it needed more than a name: a fold held by two people used to return NULL, and
-- /candidate/<bare name> then fell through to the legacy body — which reads the NAME-folder
-- shards, one folder per name, so it publishes two namesakes' preference history as one
-- person's at a 200. Measured 2026-09-03 over the whole table: 25,625 folds name exactly one
-- person and 1,478 folds / 4,092 people do not. The prerendered indexed candidate family is
-- the bare-name form, so this is the majority URL shape rather than an edge case.
--
-- ⚠️⚠️ THE ELECTION IS A TIE-BREAKER, NEVER A FILTER, and getting that backwards is a
-- REGRESSION rather than a smaller improvement. `?elections=` defaults to the NEWEST cycle
-- (ElectionContext returns `elections[0]`) and the prerendered URLs carry no query string at
-- all — so an `AND election_date = p_election` arm asks about 2026_04_19 for a candidate who
-- last stood in 2021 and returns nothing. Measured on the first cut of this function: the
-- 2-arg form resolved 25,621 of 27,103 public folds, the filtering 3-arg form resolved
-- 6,357 — 19,649 folds LOST to the very body this tier exists to stop reaching, and all of
-- them invisible because a lost fold has no namesake set either. Narrow-then-widen resolves
-- 26,006, i.e. strictly better than both, at 16 buffers.
--
-- ⚠️ It resolves 385 folds where the fold really IS several people and exactly one of them
-- stood in the requested cycle. That is deliberate and it is a DISCLOSURE obligation on the
-- caller, not a licence to stay quiet: /api/db/candidate-person returns the namesake set
-- beside the hit so the page can say the URL is shared and which cycle picked this person.
--
-- ⚠️ The residual ambiguity is an IDENTITY split, not a lookup failure: 44 (fold, election,
-- party) triples name two person rows, each an `mp-{id}` candidacy owned by one and the
-- matching `c-{party}-…` candidacy owned by the other, i.e. one human published as two.
-- `docs/plans/person-cross-party-candidate-merge-v1.md` owns that decision (an audited
-- ref-scoped manual merge). Do NOT make this function pick between them — an arbitrary pick
-- publishes one person's electoral record and another's declarations under one name.
CREATE OR REPLACE FUNCTION candidate_person_by_name(p_name text, p_party int, p_election text)
RETURNS text LANGUAGE sql STABLE AS $$
  WITH f AS (SELECT translit_bg_latin(p_name) AS fold),
  cand AS (
    SELECT cp.person_slug, cp.election_date
      FROM candidate_person cp
      JOIN person p ON p.slug = cp.person_slug
     -- `f` as a scalar subquery, NOT a comma-join: a comma after the JOIN list resets the
     -- join nest and `cp` stops being visible to anything joined after it.
     WHERE cp.candidate_name_fold = (SELECT fold FROM f)
       AND (p_party IS NULL OR cp.party_num = p_party)
       AND p.status = 'active' AND p.is_public_figure
  ),
  narrowed AS (
    SELECT DISTINCT person_slug FROM cand
     WHERE p_election IS NOT NULL AND election_date = p_election
     LIMIT 2   -- only "is it exactly one" is ever asked; two is already a refusal
  ),
  m AS (
    SELECT person_slug FROM narrowed
    UNION ALL
    -- Reached only when nobody on this fold stood in the requested cycle, which is the
    -- COMMON case for a prerendered URL: fall back to the whole fold rather than refusing.
    SELECT DISTINCT person_slug FROM cand WHERE NOT EXISTS (SELECT 1 FROM narrowed)
  )
  SELECT CASE WHEN (SELECT count(*) FROM m) = 1
    THEN (SELECT person_slug FROM m LIMIT 1) END;
$$;

-- The pre-Tier-1 signature, KEPT and delegating so the rule lives in one body.
--
-- ⚠️ Two reasons not to drop it. The DEPLOYED Cloud Function still calls it until the next
-- `deploy:db`, so dropping it 500s every bare-name candidate URL in the window between
-- applying this file and shipping the route. And `p_election` on the 3-arg form must carry
-- NO default, or `candidate_person_by_name($1, $2)` becomes ambiguous between the two
-- signatures (42725).
CREATE OR REPLACE FUNCTION candidate_person_by_name(p_name text, p_party int DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT candidate_person_by_name(p_name, p_party, NULL);
$$;

-- Every PUBLIC person who ran under one exact name fold, with the candidacies that name
-- them — the set a reader must choose from when the lookup above cannot decide, and the
-- disclosure beside a hit that the election picked out of several.
--
-- It exists so an unresolvable bare-name URL can say „these are two different people"
-- instead of rendering the legacy body, which reads the NAME-folder shards and therefore
-- merges both people's history into one page at a 200.
--
-- `oblast` is the МИР of that candidacy's strongest region — the one field that reliably
-- tells two same-named politicians apart when they share a party, which they routinely do.
-- NULL when the candidacy has no results row (a roster-only entry).
--
-- Ordering is fully determined: 75 refused folds have two people tied on their newest
-- candidacy, so `latestElection` alone would let the head of the chooser change between two
-- requests for the same URL. Candidacies are capped at 4 per person because that is what the
-- chooser renders — a 22-person fold would otherwise ship ~90 rows of JSON to draw 22.
DROP FUNCTION IF EXISTS candidate_person_namesakes(text);
CREATE OR REPLACE FUNCTION candidate_person_namesakes(p_name text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH f AS (SELECT translit_bg_latin(p_name) AS fold),
  cand AS (
    SELECT cp.person_slug,
           p.display_name,
           cp.election_date,
           cp.party_num,
           cp.candidate_slug,
           e.party_nick,
           e.party_color,
           e.total_votes,
           (SELECT x->>'oblast'
              FROM jsonb_array_elements(COALESCE(e.regions, '[]'::jsonb)) x
             ORDER BY (x->>'totalVotes')::int DESC NULLS LAST
             LIMIT 1) AS oblast
      FROM candidate_person cp
      JOIN person p ON p.slug = cp.person_slug
      LEFT JOIN person_election_stats e
             ON e.person_id = cp.person_id AND e.election_date = cp.election_date
     WHERE cp.candidate_name_fold = (SELECT fold FROM f)
       AND p.status = 'active' AND p.is_public_figure
  ),
  per_person AS (
    SELECT c.person_slug,
           c.display_name,
           max(c.election_date) AS latest_election,
           (SELECT jsonb_agg(entry ORDER BY entry->>'election' DESC)
              FROM (
                SELECT jsonb_build_object(
                         'election', c2.election_date,
                         'partyNum', c2.party_num,
                         'partyNick', c2.party_nick,
                         'partyColor', c2.party_color,
                         'candidateSlug', c2.candidate_slug,
                         'totalVotes', c2.total_votes,
                         'oblast', c2.oblast
                       ) AS entry
                  FROM cand c2
                 WHERE c2.person_slug = c.person_slug
                 ORDER BY c2.election_date DESC
                 LIMIT 4
              ) top
           ) AS candidacies
      FROM cand c
     -- display_name is functionally dependent on person_slug (the join is on p.slug), so it
     -- groups rather than aggregating — an aggregate here would read as if one person could
     -- carry several names.
     GROUP BY c.person_slug, c.display_name
  )
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'personSlug', pp.person_slug,
             'displayName', pp.display_name,
             'latestElection', pp.latest_election,
             'candidacies', pp.candidacies
           ) ORDER BY pp.latest_election DESC, pp.person_slug)
      FROM per_person pp
  ), '[]'::jsonb);
$$;
