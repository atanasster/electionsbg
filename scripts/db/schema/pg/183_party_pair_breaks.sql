-- party_pair_break — the items where two parliamentary groups voted OPPOSITE ways.
-- Plan: docs/plans/json-retirement-v2.md Tier 3c. Replaces party_pair_breaks.json (2.4 MB),
-- the drill-down behind /votes/between/:pair.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ THE PAIR KEY IS BUILT FROM THE FOLDED LABEL, and getting that wrong does not produce a
-- duplicate row — it produces a LOOKUP THAT FINDS NOTHING.
--
-- `/votes/between/:pair` is minted from party_correlation's row labels and split back into
-- two names by the client, so a spelling here that disagrees with THAT artifact is a page
-- that renders empty rather than one that renders twice. On the raw label the 51st carried
-- 84 pair keys over 13 real groups (78) — the surplus being ГЕРБ-СДС's and ПП-ДБ's variant
-- spellings paired against everyone.
--
-- ⚠️ THE LABEL IS AN ITEM-WEIGHTED MODE, NOT min(). This is the rule `groupLabels()` in
-- scripts/parliament/derived/groups.ts applies — for each canonical key, the raw spelling
-- carrying the most ITEMS wins, ties broken by the spelling that sorts first — and
-- party_correlation.json is built with it. A first draft used `min()` and matched by
-- coincidence: on the 51st the two spellings are `ГЕРБ - СДС` (3,698 items) and `ГЕРБ-СДС`
-- (177), and min() picks the same one only because a space sorts before a hyphen. One
-- outlier row spelled differently would have flipped it and emptied the page.
--
-- ⚠️ partyA SORTS BEFORE partyB, **COLLATE "C"**, and the collation is the load-bearing part.
-- The pair is UNORDERED and the client normalises with JavaScript `<`, which is UTF-16 code
-- unit order. Postgres's default collation is not: measured on this database's `en_US.utf8`,
-- `'ГЕРБ - СДС' < 'ГЕРБА'` is FALSE in SQL and TRUE in JS, because glibc primary-ignores the
-- separator. All 240 pairs happen to agree today — and collation is HOST state, so that
-- local agreement says nothing about Cloud SQL. `COLLATE "C"` is byte order, which is what
-- JS gives for these strings. Storing the other order makes half the drill-down links dead.
--
-- ⚠️ "OPPOSITE" MEANS THE TWO PLURALITIES DIFFER, not that one voted yes and the other no.
-- A group that abstained as a bloc against another's yes is a real split and the artifact
-- counted it. What is excluded is a group with NO plurality — every member absent — because
-- "they disagreed" is not a statement the data supports there.
--
-- ⚠️ THE PLURALITY IS NOT party_cohesion's `largest_bloc`. That is a COUNT (how unified);
-- this is WHICH WAY, and the two coincide only in that the winning count belongs to the
-- winning vote. `mode() WITHIN GROUP (ORDER BY vote DESC)` reproduces the builder's
-- yes > no > abstain tiebreak, the same one 135's mp_dissent uses.
--
-- contest_score = min(yes, no + abstain) / cast — the ranking key, identical to the one
-- /api/db/contested-votes applies server-side. Peaks at 0.5 on a perfectly split chamber.
--
-- TOP 20 PER PAIR, matching PAIR_TOP_N in the retired builder. The page shows a list, not a
-- corpus, and an uncapped table is ~40x larger for rows nothing renders.

DROP MATERIALIZED VIEW IF EXISTS party_pair_break CASCADE;
CREATE MATERIALIZED VIEW party_pair_break AS
WITH cast_rows AS (
  -- ⚠️ NO `title` HERE. Carrying it through the 2.46M-row GROUP BY below made the build spill
  -- 798 MB to temp for a 2 MB matview — inside one transaction with mp_similarity, on an
  -- instance whose temp_file_limit CLAUDE.md records as 2.57 GB. Narrowed, the same 4,508
  -- rows build in 74 MB. `title`, `slug` and `topic` are joined back at the end, per item.
  SELECT i.ns, i.item_id, i.date, i.item_no,
         c.vote,
         upper(replace(btrim(d.short), ' ', '')) AS party_key,
         d.short                                 AS party_label,
         i.yes, i.no, i.abstain
    FROM vote_cast c
    JOIN vote_item i ON i.item_id = c.item_id
    JOIN party_dim d ON d.party_id = c.party_id
   WHERE i.superseded_by IS NULL
     AND c.vote <> 'x'
     AND c.party_id IS NOT NULL
),
day_items AS (
  SELECT ns, date, count(*) AS n FROM vote_item WHERE superseded_by IS NULL GROUP BY ns, date
),
label_weight AS (
  -- Each raw spelling weighted by the ITEMS of the days it appears on, counted once per day
  -- per spelling — groupLabels()'s rule, which weights by `file.sessions.length`.
  SELECT x.ns, x.party_key, x.party_label, sum(di.n) AS w
    FROM (SELECT DISTINCT ns, date, party_key, party_label FROM cast_rows) x
    JOIN day_items di ON di.ns = x.ns AND di.date = x.date
   GROUP BY x.ns, x.party_key, x.party_label
),
labels AS (
  SELECT DISTINCT ON (ns, party_key) ns, party_key, party_label
    FROM label_weight
   -- Weight first, then the spelling that sorts first — groupLabels()'s tiebreak.
   ORDER BY ns, party_key, w DESC, party_label
),
plurality AS (
  -- WHICH WAY each group went on each item. mode() with DESC reproduces the builder's
  -- yes > no > abstain tiebreak; 'y' > 'n' > 'a' orders that way as chars.
  SELECT ns, item_id, date, item_no, party_key,
         mode() WITHIN GROUP (ORDER BY vote DESC) AS side,
         -- min(yes, no + abstain) / cast, from the item's own tallies. Those columns are
         -- CHAMBER-wide, which is what the retired builder used too: the score ranks the
         -- ITEM, not the pair's disagreement.
         -- ⚠️ ROUNDED TO 3 DECIMALS BEFORE RANKING, because the retired builder stored
         -- `Number(contestScoreFor(it).toFixed(3))` and then sorted on that. Rounding
         -- creates ties the full-precision value does not have, and the ranking is a
         -- top-20 cut — so an unrounded score puts a different 20 items in a different
         -- order. Measured: 1,057 of 4,508 rows disagreed with the artifact before this.
         CASE WHEN (max(yes) + max(no) + max(abstain)) > 0
              THEN round(least(max(yes), max(no) + max(abstain))::numeric
                     / (max(yes) + max(no) + max(abstain)), 3)
              ELSE 0 END AS contest_score
    FROM cast_rows
   GROUP BY ns, item_id, date, item_no, party_key
),
pairs AS (
  SELECT a.ns, a.item_id, a.date, a.item_no,
         a.contest_score,
         la.party_label AS party_a, lb.party_label AS party_b,
         a.side AS vote_a, b.side AS vote_b
    FROM plurality a
    JOIN plurality b
      ON b.ns = a.ns AND b.item_id = a.item_id
     -- Each unordered pair ONCE, ordered by the LABEL so the stored key matches what the
     -- client builds from party_correlation's labels.
    JOIN labels la ON la.ns = a.ns AND la.party_key = a.party_key
    JOIN labels lb ON lb.ns = b.ns AND lb.party_key = b.party_key
   WHERE la.party_label COLLATE "C" < lb.party_label COLLATE "C"
     AND a.side <> b.side
),
ranked AS (
  SELECT *, row_number() OVER (
           PARTITION BY ns, party_a, party_b
           -- date DESC breaks a score tie the way the builder did; item_no makes it total,
           -- so two equally-contested items on one day cannot swap between refreshes
           -- (reference_pg_payload_determinism).
           ORDER BY contest_score DESC, date DESC, item_no DESC) AS rn
    FROM pairs
)
SELECT r.ns, r.party_a, r.party_b, r.rn,
       r.date, r.item_no, i.slug, i.title, i.topic,
       r.vote_a, r.vote_b, r.contest_score
  FROM ranked r
  JOIN vote_item i ON i.item_id = r.item_id
 WHERE r.rn <= 20
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_party_pair_break_pk
  ON party_pair_break (ns, party_a, party_b, rn);

COMMENT ON MATERIALIZED VIEW party_pair_break IS
  'Top 20 items per (ns, group pair) where the two groups'' plurality votes differed. The '
  'pair key is the FOLDED label with party_a < party_b — it must match what the client '
  'builds from party_correlation, or the drill-down finds nothing rather than duplicating.';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON party_pair_break TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — party_pair_break has no ACL; run roles_readonly.sql then re-apply 183';
  END IF;
END $$;
