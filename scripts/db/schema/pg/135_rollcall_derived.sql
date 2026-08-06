-- 135_rollcall_derived.sql — the four roll-call precomputes.
--
-- Refreshed by scripts/db/load_rollcall_derived_pg.ts, in the order declared in
-- scripts/db/lib/rollcallMatviews.ts. Built on 134.
--
-- ===========================================================================
-- TWO RULES EVERY MATVIEW HERE OBEYS, both of which fail SILENTLY when broken.
--
--   1. WHERE superseded_by IS NULL. vote_item holds all 16,741 raw items; 1,645 of them
--      are re-votes that dedupeRevotes collapses, and every derived JSON artifact this
--      layer is meant to reproduce was computed after that collapse. A matview that
--      forgets the filter counts one decision twice and over-states by 9.8% — at a 200,
--      with every row count reconciling.
--
--   2. GROUP BY vote_cast.party_id, NEVER mp_seat.party_id. mp_seat carries a member's
--      LAST-SEEN affiliation; 179 of 2,366 seats change party mid-term, almost always to
--      НЕЗ when a member leaves their group. Grouping on the seat compares those 179
--      against a group they had already left — and on mp_dissent, whose whole question is
--      "did this member vote against their own group", the symptom is that defectors read
--      as unusually loyal.
--
-- The data gate holds both; the comments are here because this file is what the next
-- matview gets written against.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- mp_dissent — every cast where a member voted against their group's plurality.
-- Replaces dissents.json (31 MB), which is downloaded WHOLE by any candidate page whose
-- per-MP shard is missing (36 of them today).
DROP MATERIALIZED VIEW IF EXISTS mp_dissent CASCADE;
CREATE MATERIALIZED VIEW mp_dissent AS
WITH cast_live AS (
  SELECT c.item_id, c.ns, c.mp_id, c.vote, c.party_id
    FROM vote_cast c
    JOIN vote_item i ON i.item_id = c.item_id
   WHERE i.superseded_by IS NULL      -- rule 1
     AND c.vote <> 'x'                -- an absence is not a dissent
     AND c.party_id IS NOT NULL       -- an unaffiliated member has no line to cross
),
party_line AS (
  -- The group's plurality on each item, at CAST time (rule 2).
  -- ORDER BY vote DESC is load-bearing: on a tied party the ordering decides the line, and
  -- 'y' > 'n' > 'a' puts YES first, which is how majorityFor breaks ties (and says so).
  -- Ascending instead broke them the other way — measured 697 tied party-items and 4,976
  -- flipped rows, with the CORPUS TOTAL still agreeing to within 1, so a totals-based gate
  -- would never have seen it.
  SELECT item_id, party_id, mode() WITHIN GROUP (ORDER BY vote DESC) AS line, count(*) AS members
    FROM cast_live
   GROUP BY item_id, party_id
)
SELECT v.ns,
       v.mp_id,
       v.item_id,
       v.party_id,
       v.vote,
       p.line AS party_vote,
       p.members AS party_members
  FROM cast_live v
  JOIN party_line p USING (item_id, party_id)
 WHERE v.vote <> p.line
   -- A "plurality" of one is the member themselves; they cannot dissent from it.
   AND p.members > 1
WITH NO DATA;
CREATE INDEX IF NOT EXISTS idx_mp_dissent_ns_mp ON mp_dissent (ns, mp_id);
CREATE INDEX IF NOT EXISTS idx_mp_dissent_item ON mp_dissent (item_id);

-- ---------------------------------------------------------------------------
-- mp_attendance — participation per seat. Replaces attendance.json.
DROP MATERIALIZED VIEW IF EXISTS mp_attendance CASCADE;
CREATE MATERIALIZED VIEW mp_attendance AS
SELECT c.ns,
       c.mp_id,
       count(*)                                   AS items,
       count(*) FILTER (WHERE c.vote <> 'x')      AS present,
       count(*) FILTER (WHERE c.vote = 'x')       AS absent
  FROM vote_cast c
  JOIN vote_item i ON i.item_id = c.item_id
 WHERE i.superseded_by IS NULL                    -- rule 1
 GROUP BY c.ns, c.mp_id
WITH NO DATA;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_attendance_pk ON mp_attendance (ns, mp_id);

-- ---------------------------------------------------------------------------
-- party_cohesion — how unified each group votes, per sitting. Replaces cohesion.json.
--
-- TWO-STAGE GROUP BY, not a LATERAL. The obvious correlated form returns one row per
-- distinct vote value and so MULTIPLIES the outer row, inflating the denominator by that
-- factor — measured ГЕРБ - СДС on 2026-04-30 at 0.9227 against cohesion.json's 0.9704. It
-- is exact only on unanimous items, which is exactly why a spot check passes it. It was
-- also 59x slower (3,252 ms vs 55 ms on the 52nd alone).
DROP MATERIALIZED VIEW IF EXISTS party_cohesion CASCADE;
CREATE MATERIALIZED VIEW party_cohesion AS
WITH by_vote AS (
  -- One row per (item, party, vote value).
  SELECT i.ns, i.date, c.item_id, c.party_id, c.vote, count(*) AS n
    FROM vote_cast c
    JOIN vote_item i ON i.item_id = c.item_id
   WHERE i.superseded_by IS NULL                  -- rule 1
     AND c.vote <> 'x'
     AND c.party_id IS NOT NULL                   -- rule 2: cast-time affiliation
   GROUP BY i.ns, i.date, c.item_id, c.party_id, c.vote
),
per_item AS (
  -- Collapse to one row per (item, party): how many voted, and how many voted together.
  SELECT ns, date, item_id, party_id,
         sum(n) AS cast_votes,
         max(n) AS largest_bloc
    FROM by_vote
   GROUP BY ns, date, item_id, party_id
)
SELECT ns, date, party_id,
       count(*)                                        AS items,
       avg(largest_bloc::numeric / cast_votes)         AS cohesion
  FROM per_item
 GROUP BY ns, date, party_id
WITH NO DATA;
CREATE UNIQUE INDEX IF NOT EXISTS idx_party_cohesion_pk
  ON party_cohesion (ns, date, party_id);

-- ---------------------------------------------------------------------------
-- mp_similarity — pairwise agreement. Replaces similarity.json (11.7 MB).
--
-- STORES dot AND overlap, NOT an agreement rate. The measure the consumers are calibrated
-- for is a COSINE over ±1 vote vectors (similarity.ts: yes=+1, no=−1, abstain=0, absent
-- masked out), and similarityClass.ts sets its "voting twin" thresholds against that scale.
-- An agree/shared rate is a different measure on a different scale — substituting it would
-- have relabelled twins across every page that shows them, silently and sitewide.
--
--   score = dot / (norm(a) * norm(b))
--
-- The two norms are over each member's FULL vector, not over the pair's overlap — that
-- asymmetry is in the original and it matters, because it is what makes a member with few
-- votes score lower against everyone rather than spuriously high against the one person
-- they overlap with. Norms live in mp_vote_norm below so they are computed once per member
-- rather than per pair.
--
-- The ONLY object here whose cost scales quadratically, which is precisely why it is a
-- matview and not a query: ~67 s to build all nine parliaments locally, against 164 ms and
-- ~36k buffers for ONE member's row — 18x over the live budget.
--
-- Stored one-directional (a_mp < b_mp) and read from both sides, which halves the row count.
DROP MATERIALIZED VIEW IF EXISTS mp_vote_norm CASCADE;
CREATE MATERIALIZED VIEW mp_vote_norm AS
SELECT c.ns,
       c.mp_id,
       -- v² is 1 for yes/no and 0 for abstain, so the squared norm is just the yes+no
       -- count. Absent is not in the vector at all.
       count(*) FILTER (WHERE c.vote IN ('y', 'n')) AS norm_sq
  FROM vote_cast c
  JOIN vote_item i ON i.item_id = c.item_id
 WHERE i.superseded_by IS NULL                  -- rule 1
 GROUP BY c.ns, c.mp_id
WITH NO DATA;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_vote_norm_pk ON mp_vote_norm (ns, mp_id);

DROP MATERIALIZED VIEW IF EXISTS mp_similarity CASCADE;
CREATE MATERIALIZED VIEW mp_similarity AS
WITH cast_live AS (
  SELECT c.item_id, c.ns, c.mp_id,
         CASE c.vote WHEN 'y' THEN 1 WHEN 'n' THEN -1 ELSE 0 END AS v
    FROM vote_cast c
    JOIN vote_item i ON i.item_id = c.item_id
   WHERE i.superseded_by IS NULL                -- rule 1
     AND c.vote <> 'x'                          -- absent is masked out, not zeroed
)
SELECT a.ns,
       a.mp_id AS a_mp,
       b.mp_id AS b_mp,
       count(*)          AS overlap,
       sum(a.v * b.v)    AS dot
  FROM cast_live a
  JOIN cast_live b ON b.item_id = a.item_id AND b.mp_id > a.mp_id
 GROUP BY a.ns, a.mp_id, b.mp_id
WITH NO DATA;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_similarity_pk
  ON mp_similarity (ns, a_mp, b_mp);
CREATE INDEX IF NOT EXISTS idx_mp_similarity_b ON mp_similarity (ns, b_mp);

COMMENT ON MATERIALIZED VIEW mp_dissent IS
  'Casts against the member''s own group plurality. Groups on vote_cast.party_id (cast time), never mp_seat.';
COMMENT ON MATERIALIZED VIEW mp_similarity IS
  'Pairwise dot + overlap over ±1 vote vectors. score = dot / (norm_a * norm_b) via mp_vote_norm — NOT agree/shared, which is a different scale. Stored a_mp < b_mp; read both sides.';
