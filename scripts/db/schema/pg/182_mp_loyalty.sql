-- mp_loyalty — how often a member votes with their own group's line.
-- Plan: docs/plans/json-retirement-v2.md Tier 2. Replaces loyalty.json and the loyalty arm
-- of the per-MP shard tree (parliament/votes/derived/per-mp/, 2,330 files / 43 MB).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHY A MATVIEW AND NOT A QUERY. The derivation is two lines — `withParty = votesCast -
-- dissents` — and the first cut computed it live per request. Measured on the 51st that is
-- 22,899 buffers, because `votesCast` needs a per-member count over the whole parliament's
-- 1.1M casts. That runs on every candidate page. Precomputed it is 2,366 rows and a PK seek.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ `withParty` IS THE COMPLEMENT OF mp_dissent, and that is exact rather than approximate.
-- mp_dissent (135) holds every cast that DIFFERS from the member's own group line, under the
-- same `mode() WITHIN GROUP (ORDER BY vote DESC)` tiebreak (yes > no > abstain) the retired
-- builder's majorityFor() used. So the casts that are NOT dissents are the ones that agreed.
-- Verified against loyalty.json on the 51st: votesCast, withParty and loyaltyPct match to six
-- decimals for every member checked.
--
-- The dependency is real and one-directional: this must be refreshed AFTER mp_dissent, which
-- rollcallMatviews.ts's array order guarantees. Refreshing it first yields loyalty computed
-- against the previous vintage's dissents — a wrong percentage, not a stale one.
--
-- ⚠️ `votes_cast` IS NOT mp_attendance.present BY DEFINITION, but it EQUALS it today —
-- and the distinction is worth stating precisely, because an earlier draft of this comment
-- asserted a difference that does not exist and its own gate caught it.
--
-- Attendance counts every non-absent cast; this counts only casts made WHILE AFFILIATED
-- (`party_id IS NOT NULL`), because a member with no group has no line to be loyal to.
-- Measured 2026-08-21: **0 of 4,017,519 casts carry a NULL party_id**, so the filter is
-- currently a no-op and the two numbers coincide for all 2,330 members.
--
-- It stays because the definitions differ even when the values do not: the moment the corpus
-- carries one unaffiliated cast, loyalty must not count it and attendance must. mp_loyalty.
-- data.test.ts pins the equality as a MEASURED FACT rather than as a requirement, so the day
-- it breaks is a day someone reads this note instead of a day two percentages quietly drift.
--
-- The three filters are 135's, for the reason 181's header gives: a divergence means two
-- numbers on one page disagree about the same member.

DROP MATERIALIZED VIEW IF EXISTS mp_loyalty CASCADE;
CREATE MATERIALIZED VIEW mp_loyalty AS
WITH cast_rows AS (
  SELECT c.ns, c.mp_id, count(*) AS votes_cast
    FROM vote_cast c
    JOIN vote_item i ON i.item_id = c.item_id
   WHERE i.superseded_by IS NULL
     AND c.vote <> 'x'
     AND c.party_id IS NOT NULL
   GROUP BY c.ns, c.mp_id
),
d AS (
  SELECT ns, mp_id, count(*) AS dissents FROM mp_dissent GROUP BY ns, mp_id
)
SELECT r.ns,
       r.mp_id,
       r.votes_cast,
       r.votes_cast - COALESCE(d.dissents, 0) AS with_party,
       -- NULL, not 0, when a member cast nothing while affiliated. 0 reads as "never voted
       -- with their group", which is a claim about a named member that the data does not
       -- make; the consumer renders an absent figure instead.
       (r.votes_cast - COALESCE(d.dissents, 0))::numeric
         / NULLIF(r.votes_cast, 0)            AS loyalty_pct
  FROM cast_rows r
  LEFT JOIN d ON d.ns = r.ns AND d.mp_id = r.mp_id
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_loyalty_pk ON mp_loyalty (ns, mp_id);

COMMENT ON MATERIALIZED VIEW mp_loyalty IS
  'Per-member party-line loyalty: votes cast WHILE AFFILIATED, how many agreed with the '
  'group line, and the ratio. withParty is the complement of mp_dissent, so this must be '
  'refreshed after it. A DIFFERENT DEFINITION from mp_attendance.present (affiliated casts '
  'vs all non-absent casts) that currently yields the same number, since no cast in the '
  'corpus has a NULL party_id — see the header.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON mp_loyalty TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — mp_loyalty has no ACL; run roles_readonly.sql then re-apply 182';
  END IF;
END $$;
