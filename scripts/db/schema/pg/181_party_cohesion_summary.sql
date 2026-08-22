-- party_cohesion_summary — the per-(ns, party) rollup the /parliament/cohesion table and the
-- dashboard tile render, and the half of cohesion.json that party_cohesion (135) cannot
-- reconstruct.
-- Plan: docs/plans/json-retirement-v2.md Tier 3a.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHY A SECOND MATVIEW AND NOT A QUERY OVER THE FIRST
--
-- `party_cohesion` is grained per (ns, DATE, party) and stores `items` + a per-date mean.
-- Two of the four columns both consumers render survive that fold and two do not:
--
--   itemsCovered    = sum(items) over dates            ✓ derivable
--   meanCohesion    = items-weighted mean over dates   ✓ derivable (identical to the
--                                                        unweighted mean over ITEMS)
--   medianCohesion  = median over per-ITEM scores      ✗ a median does not fold
--   membersTracked  = distinct MPs per (ns, party)     ✗ not a column of party_cohesion
--
-- Shipping the two that fold and dropping the two that do not would have quietly removed
-- two columns from a rendered table. Recomputing them live is a whole-corpus pass over
-- 4M casts on a page load. So they are precomputed here, from the SAME `by_vote`/`per_item`
-- CTEs 135 uses — copied deliberately rather than shared, because a view over `per_item`
-- would make 135's DROP … CASCADE take this with it.
--
-- ⚠️ THE THREE FILTER RULES MUST MATCH 135 EXACTLY, or the two disagree about the same
-- party on the same page: `superseded_by IS NULL` (the 1,645 re-voted items are not counted
-- twice), `vote <> 'x'` (an absent member is not a dissenting one), and
-- `party_id IS NOT NULL` — the CAST-TIME affiliation, never mp_seat's, because 179 of 2,366
-- seats change party mid-term and grouping on the seat compares those members against a
-- group they had already left.
--
-- ⚠️ KEYED ON THE FOLDED SPELLING, NOT ON party_id — and this cannot be deferred to the
-- route the way party_cohesion defers it. The source renames a group mid-term: the 51st
-- carries both `ГЕРБ - СДС` (3,698 items) and `ГЕРБ-СДС` (177) under DIFFERENT party_id
-- rows, and `ПП-ДБ` likewise, so grouping on party_id returns 13 rows for the 51st where
-- the page shows 11 — a reader sees a group vanish and a near-identical one appear.
--
-- /api/db/party-cohesion folds them at query time (`GROUP BY upper(replace(btrim(short), '
-- ', ''))`) because a mean and a sum both fold. A MEDIAN does not: the median of two
-- groups' medians is not the median of their union. So the fold has to happen here, over
-- the per-item scores, before the percentile is taken.
--
-- ⚠️ `membersTracked` COUNTS MEMBERS WHO CAST A VOTE, not the group's roll. The JSON builder
-- counted the same way (it adds to its member set inside the vote loop), so this reproduces
-- it — but the number is "how many of this group we observed voting", and a group whose
-- members all abstained from a sitting contributes none of them for that sitting.

DROP MATERIALIZED VIEW IF EXISTS party_cohesion_summary CASCADE;
CREATE MATERIALIZED VIEW party_cohesion_summary AS
WITH cast_rows AS (
  SELECT i.ns, c.item_id, c.mp_id, c.vote,
         upper(replace(btrim(d.short), ' ', '')) AS party_key,
         d.short                                 AS party_label
    FROM vote_cast c
    JOIN vote_item i ON i.item_id = c.item_id
    JOIN party_dim d ON d.party_id = c.party_id
   WHERE i.superseded_by IS NULL
     AND c.vote <> 'x'
     AND c.party_id IS NOT NULL
),
by_vote AS (
  SELECT ns, item_id, party_key, vote, count(*) AS n
    FROM cast_rows
   GROUP BY ns, item_id, party_key, vote
),
per_item AS (
  SELECT ns, item_id, party_key,
         sum(n) AS cast_votes,
         max(n) AS largest_bloc
    FROM by_vote
   GROUP BY ns, item_id, party_key
),
members AS (
  SELECT ns, party_key,
         count(DISTINCT mp_id) AS members_tracked,
         -- min(), the same tiebreak /api/db/party-cohesion uses, so the two cannot disagree
         -- about which spelling of a renamed group is displayed.
         min(party_label)      AS party_label
    FROM cast_rows
   GROUP BY ns, party_key
)
SELECT p.ns,
       p.party_key,
       m.party_label,
       count(*)                                                    AS items_covered,
       avg(p.largest_bloc::numeric / p.cast_votes)                 AS mean_cohesion,
       percentile_cont(0.5) WITHIN GROUP (
         ORDER BY p.largest_bloc::numeric / p.cast_votes)          AS median_cohesion,
       COALESCE(m.members_tracked, 0)                              AS members_tracked
  FROM per_item p
  LEFT JOIN members m ON m.ns = p.ns AND m.party_key = p.party_key
 GROUP BY p.ns, p.party_key, m.party_label, m.members_tracked
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_party_cohesion_summary_pk
  ON party_cohesion_summary (ns, party_key);

COMMENT ON MATERIALIZED VIEW party_cohesion_summary IS
  'Per-(ns, party) cohesion rollup — items covered, mean, MEDIAN over per-item scores and '
  'the number of members observed voting. The median and the member count are the two '
  'columns party_cohesion (135) cannot reproduce, because a median does not fold across its '
  'per-date grain. Filters must stay identical to 135''s.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON party_cohesion_summary TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — party_cohesion_summary has no ACL; run roles_readonly.sql then re-apply 181';
  END IF;
END $$;
