-- The My-Area "open tenders here" tile — the replacement for the 265-file
-- data/myarea/place_tenders/<obshtina>.json shard family.
-- Plan: docs/plans/json-retirement-v2.md Tier 4a.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHY THIS FAMILY IS WORTH MOVING DESPITE BEING 1.1 MB
--
-- Not the bytes — the CHURN. build_alerts.ts rebuilds and re-uploads all 265 files every day
-- from `data/procurement/tenders/recent_by_buyer.json`, and both sides of that are already
-- derived from `tenders`: the shard is a cache of a Postgres table with no computation in it
-- that the database cannot do. Measured 2026-08-21 over the last 300 commits, data/myarea/
-- is the highest churn-per-byte tree in the repo (14,746 file-touches).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ FOUR SEMANTICS THAT ARE NOT THE OBVIOUS ONES. Each was read off the builder rather than
-- guessed, and all four change the numbers a reader sees.
--
--   1. THE WINDOW IS ANCHORED ON THE CORPUS, NOT ON `now()`.
--      `since = max(publication_date) - 180 days`, per writeRecentByBuyer(). Anchoring on
--      current_date instead looks equivalent and is not: when the ЦАИС feed stalls — which is
--      exactly when someone checks this tile — a now()-anchored window slides off the end of
--      the corpus and the tile empties out, reporting "no procedures here" about a município
--      whose procedures we simply have not fetched. The corpus anchor degrades to "the last
--      180 days we know about", which is the true statement.
--
--   2. AT MOST 6 TENDERS PER BUYER (RECENT_PER_BUYER), newest first, BEFORE anything is
--      counted. So `count` is not "procedures in the window" — it is "procedures in the
--      window, capped per buyer", and for a busy município the two differ. Dropping the cap
--      would silently inflate every count and total on the tile relative to what it showed
--      the day before the migration.
--
--   3. A CANCELLED PROCEDURE IS COUNTED SEPARATELY AND IS NOT IN `count`, `total` OR `top`.
--      The tile is a forecast-spend pipeline and a cancelled procedure is no longer a
--      forecast. It still gets reported, as its own number, so "3 cancelled" stays visible
--      rather than becoming a silent subtraction.
--
--   4. `buyerName` IS THE AWARDER'S NAME, NOT `tenders.buyer_name`.
--      The shards took it from the awarder rollup, which resolves a buyer to the spelling on
--      its MOST RECENT contract — deliberately, because the same buyer is spelled several
--      ways across the corpus and the byte-smallest variant is the SHOUTING one
--      ("ОБЩИНА БУРГАС" rather than "Община Бургас"). Reproduced here with the same
--      ORDER BY c.date DESC NULLS LAST, c.key DESC tiebreak as scripts/db/lib/muni_awarders.ts.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- KEYED BY OBSHTINA, RESOLVED THROUGH EKATTE.
--
-- The shards are keyed by obshtina code; the awarder set is keyed by EKATTE
-- (`readMunicipalAwardersByEkatte`, `source='geo' AND is_local_hq AND tier='municipal'`).
-- The builder joins them through the município's centroid EKATTE, so this does the same via
-- place_dim. Filtering awarder_seats.municipality by NAME instead would be a different set:
-- the column is a label, not a code, and two municipalities share a name.
--
-- ⚠️ `tenders.publication_date` IS `text`, NOT `date`. A `now() - interval` bound raises
-- 42883 outright (that is not a subtle failure — it is a 500 on the route). The comparisons
-- here are lexicographic over ISO-8601, which is order-preserving for that format and stays
-- sargable on idx_tenders_buyer_date (buyer_eik, publication_date DESC, unp DESC).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- PARITY WITH THE SHARDS IT REPLACES, measured 2026-08-21 over all 286:
--   since / count / cancelled : 286 of 286 identical
--   totalEstimatedEur         : 243 identical, 43 differ
--
-- ⚠️ ALL 43 ARE THE SAME THING AND IT IS NOT A REGRESSION: a publication_date TIE at the
-- per-buyer cap boundary, which the builder breaks arbitrarily and this does not. Its sort is
-- `b.publicationDate.localeCompare(a.publicationDate)` with NO tiebreak, so which of two
-- same-day procedures survives `slice(0, 6)` falls out of JS's stable sort over corpus order —
-- i.e. out of ingest order. Worked example, DOB03: rows 6 and 7 are 00479-2026-0012 and
-- 00479-2026-0011, both 2026-05-11; the shard kept 0011, this keeps 0012, and the €15,209.81
-- difference is exactly those two. The remaining 42 are the same shape.
--
-- `unp DESC` is the tiebreak because the УНП's trailing sequence is filing order within a
-- buyer-year, so it continues "newest first" rather than introducing a second ordering idea.
-- Reproducing the builder's pick is not an option and would not be desirable: it is a
-- property of ingest order, not of the procurement (reference_pg_payload_determinism).
--
-- PERFORMANCE, measured 2026-08-21 on the busiest município (Sofia, ekatte 68134, 221
-- tenders in the window): 212 buffers / 2.2 ms, Index Scan on idx_tenders_buyer_date. The
-- per-call budget for a tile is 2,000 buffers.

CREATE OR REPLACE FUNCTION myarea_place_tenders(p_obshtina text)
RETURNS TABLE (
  obshtina            text,
  since               text,
  total_count         bigint,
  cancelled_count     bigint,
  total_estimated_eur double precision,
  top                 json
)
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH anchor AS (
    -- ONE scan for the corpus anchor. `max(publication_date)` over a text column rides
    -- idx_tenders_order's leading key, so this is an index max, not a seq scan.
    SELECT to_char(
             (max(publication_date)::date - 180), 'YYYY-MM-DD'
           ) AS since
      FROM tenders
     WHERE publication_date IS NOT NULL AND publication_date <> ''
  ),
  buyers AS MATERIALIZED (
    -- The município's municipal-tier awarders, resolved obshtina -> ekatte -> seats. The
    -- predicate is muni_awarders.ts's, verbatim; a divergence here silently changes which
    -- buyers the tile speaks for.
    -- ⚠️ MATERIALIZED, and the name is TWO index probes rather than an ORDER BY.
    -- Without the hint the planner inlines this and re-evaluates the name subquery once per
    -- CAPPED ROW instead of once per buyer — 18 loops for 3 buyers on PDV17. With the
    -- ORDER BY form that first shipped, that was 18,742 buffers, 9x the per-call budget;
    -- with the two-probe name below it is worth 180 -> 70. Both fixes are kept: the hint is
    -- what bounds the loop count as a município's buyer set grows, which is the axis the
    -- cheap lookup does not address.
    -- The name subquery itself was then still 1,300 heap rows per buyer: `ORDER BY date DESC
    -- NULLS LAST, key DESC` cannot ride idx_contracts_awarder_date (awarder_eik, date), so it
    -- sorted every contract the buyer has. Taking max(date) off the index and then the row at
    -- that date is two probes and no sort. It is a DIFFERENT tiebreak from muni_awarders.ts's
    -- `key DESC` — verified 2026-08-21 to pick the same name for all 264 municipal buyers,
    -- and both are only tiebreaks over one buyer's same-day spellings.
    SELECT s.eik,
           (SELECT max(c.awarder_name)
              FROM contracts c
             WHERE c.awarder_eik = s.eik
               AND c.date = (SELECT max(c2.date) FROM contracts c2
                              WHERE c2.awarder_eik = s.eik)) AS name
      FROM awarder_seats s
     WHERE s.source = 'geo'
       AND s.is_local_hq
       AND s.tier = 'municipal'
       AND s.ekatte IS NOT NULL
       -- ⚠️ THE SEAT, NOT THE SETTLEMENTS OF THE OBSHTINA. `place_dim.seat_ekatte` (117) is
       -- the EKATTE a município is administered FROM, which is what build_alerts.ts looks
       -- awarders up by. The obvious alternative — every settlement whose obshtina_code is
       -- p_obshtina — is measurably wrong: a seat is SHARED, so it drops 28 municipalities
       -- to zero buyers, 24 of them Sofia and Plovdiv rayons whose municipal buyer really is
       -- the parent city's Столична/Пловдив община, plus the Добрич-селска and Ямбол pairs.
       -- Measured against all 286 shards: 239 identical, 28 zeroed by that rule, 0 improved.
       AND s.ekatte = (
             SELECT pd.seat_ekatte FROM place_dim pd
              WHERE pd.kind = 'obshtina' AND pd.code = p_obshtina
           )
  ),
  capped AS (
    -- RECENT_PER_BUYER = 6, applied PER BUYER before any aggregate — see semantic (2).
    SELECT b.name AS buyer_name, t.unp, t.subject, t.estimated_value_eur,
           t.publication_date, t.is_cancelled
      FROM buyers b
      CROSS JOIN LATERAL (
        SELECT t2.unp, t2.subject, t2.estimated_value_eur,
               t2.publication_date, t2.is_cancelled
          FROM tenders t2
         WHERE t2.buyer_eik = b.eik
           AND t2.publication_date >= (SELECT since FROM anchor)
         ORDER BY t2.publication_date DESC, t2.unp DESC
         LIMIT 6
      ) t
  )
  SELECT p_obshtina,
         (SELECT since FROM anchor),
         count(*) FILTER (WHERE NOT is_cancelled),
         count(*) FILTER (WHERE is_cancelled),
         COALESCE(sum(estimated_value_eur) FILTER (WHERE NOT is_cancelled), 0),
         COALESCE(
           (SELECT json_agg(r)
              FROM (
                SELECT unp, buyer_name, subject, estimated_value_eur,
                       publication_date, is_cancelled
                  FROM capped
                 WHERE NOT is_cancelled
                 -- `unp` breaks the tie so two equal-valued procedures cannot swap places
                 -- between calls (reference_pg_payload_determinism).
                 ORDER BY estimated_value_eur DESC NULLS LAST, unp DESC
                 LIMIT 5
              ) r),
           '[]'::json)
    FROM capped
   -- A município with no procedures in the window returns ONE row of zeros rather than no
   -- rows: the shard family expressed that as a 404 the hook mapped to null, and the route
   -- reproduces the null from total_count = 0. An ungrouped aggregate over an empty set
   -- already yields one row, so this is the natural shape rather than a special case.
$$;

-- Role-guarded — see 150/151's note. roles_readonly.sql is a one-time manual step on Cloud
-- SQL, and exec() sends a migration as ONE transaction, so a bare GRANT raises 42704 and
-- rolls the whole file back on a database that never ran it. Guarded, it SKIPS instead — see
-- CLAUDE.md's db:pg:bootstrap note for why that inversion is itself a hazard (the load
-- succeeds and the object carries no ACL until /api/db 42501s).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION myarea_place_tenders(text) TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — myarea_place_tenders() has no ACL; run roles_readonly.sql then re-apply 179';
  END IF;
END $$;
