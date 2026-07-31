-- 124_procurement_payloads.sql — the procurement DASHBOARD payloads, precomputed per scope.
-- Behind six /api/db routes: procurement-overview, -flow, -rankings, -concentration,
-- -sectors and -benchmarks.
--
-- WHY. Each of those routes ran a live whole-corpus aggregate on every cache miss. Three of
-- them exceeded the 10 s statement_timeout the /api/db pool sets (functions/index.js) and
-- returned 500 in production, measured in Cloud Run logs:
--
--   /api/db/procurement-overview?from=2023-04-02&to=2024-06-09   10.010 s -> 500
--   /api/db/procurement-flow                                     10.006 s -> 500
--
-- The precision is a configured limit, not organic cost. Production is a db-g1-small with a
-- cold buffer cache, so the number that predicts it is PAGES TOUCHED, not local wall clock:
--
--   function                   buffers, all (NULL/NULL)   buffers, one ns: window   cache before
--   procurement_concentration  411,245  (3.3 GB)          58,887                    NONE
--   procurement_rankings       397,604  (3.2 GB)          56,254                    'all' (031)
--   procurement_flow           393,851  (3.2 GB)          --                        NONE
--   procurement_sectors        392,293  (3.1 GB)          51,624                    NONE
--   procurement_benchmarks     237,780  (1.9 GB)          38,888                    NONE
--   procurement_overview       198,735  (1.6 GB)          45,375                    'all' (025)
--
-- Buffers are x8 kB and reproduce run to run within ~1%. Every one of these exceeds a
-- db-g1-small's 1.7 GB of RAM on the full corpus, so none can be cache-resident there.
--
-- LOCAL WALL CLOCK IS DELIBERATELY NOT THE COLUMN THAT ORDERS THIS TABLE. Warm, these run
-- 232-974 ms and the ranking is different (procurement_overview is the slowest per page,
-- procurement_rankings the slowest outright) — because with the pages already cached what is
-- left is CPU. That inversion is the whole point: local timing measures the half of the cost
-- prod does not have, which is why three of these could 500 in production while every local
-- measurement looked fine. Timings here move ~2x with cache state and are not worth quoting
-- to three digits; the buffer counts are the stable signal.
--
-- IT IS NOT AN INDEXING PROBLEM. The cost is a GROUP BY over the contract corpus, and no
-- index removes a grouped aggregate. The only way to stop paying it per request is to stop
-- computing it per request. (Same conclusion, same reasoning, as 123.)
--
-- WHY ALL SIX AND NOT ONLY THE TWO THAT 500'd. The other four are the same shape, and two of
-- them are WORSE: procurement_concentration touches more pages than procurement_flow and has
-- no cache whatsoever. Nothing in the code makes them safer — only their traffic. The fan-out
-- is cheap enough that excluding them buys nothing: measured LOCAL, warm, on exactly the
-- UNION ALL below —
--
--   6 kinds x 30 scopes = 180 rows, 0 NULL payloads, plain REFRESH ~10.1 s,
--   7.6 MB on disk (pg_total_relation_size; the payloads are 26 MB of jsonb before TOAST
--   compression, which is the figure the plan's fan-out table quotes).
--
-- For comparison, the precomputes already on this path: 119 ~12 s, 122 ~20 s, 123 ~9.3 s /
-- 22 MB. The whole family costs about what one of its neighbours does — less, on disk.
-- Covering only overview + flow would have been ~7 s, in exchange for leaving four routes
-- able to 500.
--
-- Read cost after: 3.4-4.9 ms for the flow/all row — an index seek plus the TOAST fetch of a
-- 367 kB payload, against 393,851 buffers live. Measure this with \timing, NOT with EXPLAIN:
-- EXPLAIN does not count TOAST fetches, so it reports a flattering 2 buffers / 0.12 ms for a
-- read that really costs ~45 buffers.
--
-- CLOUD SQL IS UNMEASURED and will be materially slower — 123's 9.3 s local build took 75 s
-- there, a factor of 8. Budget minutes, not seconds, and record the real number on the first
-- run of db:load:procurement-scopes:pg:cloud.
--
-- ZERO NULL PAYLOADS IS A LOAD-BEARING PROPERTY, not an observation. Every (kind, scope) pair
-- yields a real object — verified across all 180 — so the route can read "row present, payload
-- NULL" as unambiguously NOT BUILT and warn on it. That is why the miss logic here is simpler
-- than 123's, which had to tell "this settlement has no seated buyer" (ordinary, silent) from
-- "this scope was never built" (an operational error, loud).
--
-- IT DOES NOT RE-IMPLEMENT THE AGGREGATIONS. Like 119 and 123, it unnests the functions that
-- already exist, so a methodology change lands in 025/026/027/031/036/037 alone and this
-- follows. Duplicating their SQL here is the drift those files' headers forbid.
--
-- TWO INPUTS: contracts AND awarder_seats. Declared as
-- inputs: ["contracts", "awarder_seats"] in scripts/db/lib/scopedMatviews.ts.
--
-- The second one is easy to get wrong and expensive to get wrong, so it is written out here.
-- Five of the six functions read only contracts (+ company_politicians / tr_companies, which
-- have no ScopedInput). procurement_concentration is the exception: it resolves each row's
-- `oblast` from awarder_seats — 026 line 62, and 026's own header declares the dependency —
-- and 87% of the 2,755 rows in the `all` scope carry one. Declaring contracts alone would
-- mean a standalone `db:load:awarder-seats:pg` never refreshes this matview, and
-- /procurement/concentration would serve the PREVIOUS seat attribution at a 200: an oblast
-- that has since moved, or a null where a seat was newly resolved, with nothing red anywhere.
--
-- NO EXISTING GATE CATCHES A MIS-DECLARED `inputs`. The exhaustiveness assertion in
-- procurement_settlement_payloads.data.test.ts checks only that a per-scope matview is PRESENT
-- in SCOPED_MATVIEWS — it cannot tell whether the declared inputs match what the matview
-- actually reads. procurement_payloads.data.test.ts adds that check.
--
-- place_dim is genuinely absent from all six, so unlike 123 this matview is NOT rebuilt by a
-- place reload — that would be work on an input it cannot see.
--
-- DETERMINISM IS PLAN-DEPENDENT FOR TWO OF THE SIX, which the data gate must account for.
-- At a fixed plan all 180 payloads are byte-stable and stored == live. Under a parallel /
-- non-hashagg plan, `rankings` and `concentration` still move: SUM() over double precision is
-- order-dependent, and at these magnitudes that flips a ROUND()ed EUR scalar by 1. The
-- ordering is not the problem — those two already carry the rounded sort keys and eik
-- tiebreaks the house convention prescribes — the differing bytes are a VALUE. (`flow` used to
-- move for the other reason, no ORDER BY on its nodes/links aggregates at all; 027 now has
-- one, added with this migration, so it and overview/sectors/benchmarks are plan-stable.)
-- So a stored-vs-live gate must either pin the plan or compare with a +/-1 tolerance;
-- exact jsonb equality would make it fail on a planner change rather than on staleness, which
-- is what it is for. Cloud SQL choosing a parallel plan is the plausible trigger.
--
-- THE ROUTE DEGRADES TO THE LIVE FUNCTION when this matview cannot answer, so it ships in any
-- order, to any database — the opposite of cpv_catalog (121) and contractor_rank (122), which
-- must be loaded BEFORE the deploy that reads them. The difference is what degrading yields:
-- an empty CPV picker is a WRONG answer, whereas here it is the RIGHT answer computed slowly,
-- which is simply today's behaviour. The cost is that every reason the fast path was skipped
-- is otherwise silent, so the route logs pp:not-built / pp:read-failed once per process. That
-- log, not latency, is the signal that the cloud loader never ran.
--
-- REFRESHED CONCURRENTLY (the UNIQUE index below is what makes that legal) on every path that
-- refreshes WITHOUT re-applying this file — i.e. the contracts reload. The scopes loader
-- applies this file first, and the DROP + CREATE … WITH NO DATA below means its refresh always
-- meets a freshly-created, unpopulated matview: it raises 0A000 and takes the PLAIN form every
-- run, not just the first (refreshScopedPrecomputes, scripts/db/lib/scopedMatviews.ts, handles
-- the fallback). Inherited from 119/122/123, which have the same shape.
--
-- A plain REFRESH holds an AccessExclusiveLock, so a dashboard request landing mid-rebuild
-- would otherwise queue behind it, burn the 10 s statement_timeout waiting, and reach the live
-- path with no budget left — a 500 from the very code path added to prevent 500s. The /api/db
-- pool sets lock_timeout=2s (functions/index.js, added with 123) and the route treats the
-- resulting lock error as a miss.
--
-- See docs/plans/db-route-timeouts-v1.md.

DROP MATERIALIZED VIEW IF EXISTS procurement_payloads;
-- WITH NO DATA: this file is applied inside one implicit transaction, so a populating CREATE
-- would hold an AccessExclusiveLock for the whole 13 s build AND then be recomputed by the
-- loader's REFRESH straight after — paying twice, half of it under exactly the lock
-- CONCURRENTLY exists to avoid. The loader populates it; the route falls back to the live
-- functions until it does.
--
-- UNION ALL of six SELECTs rather than a CASE over one CROSS JOIN: this is the shape that was
-- measured at 13.1 s, and it keeps each kind's function call on its own line where a seventh
-- can be added without touching the other six.
--
-- `kind` is text, not an enum, so adding a seventh function is one line here and one line in
-- the route's KIND map — no type migration.
CREATE MATERIALIZED VIEW procurement_payloads AS
  SELECT 'overview'::text AS kind, scope_key,
         procurement_overview(date_from, date_to)      AS payload FROM procurement_scopes
  UNION ALL
  SELECT 'flow',          scope_key,
         procurement_flow(date_from, date_to)                    FROM procurement_scopes
  UNION ALL
  SELECT 'rankings',      scope_key,
         procurement_rankings(date_from, date_to)                FROM procurement_scopes
  UNION ALL
  SELECT 'concentration', scope_key,
         procurement_concentration(date_from, date_to)           FROM procurement_scopes
  UNION ALL
  SELECT 'sectors',       scope_key,
         procurement_sectors(date_from, date_to)                 FROM procurement_scopes
  UNION ALL
  SELECT 'benchmarks',    scope_key,
         procurement_benchmarks(date_from, date_to)              FROM procurement_scopes
WITH NO DATA;

-- REQUIRED for REFRESH … CONCURRENTLY, and the natural key besides. This is the WHOLE index
-- list: the matview is only ever read by one query shape — a (kind, scope_key) point lookup
-- joined from procurement_scopes — so there is nothing else to index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pp_kind_scope
  ON procurement_payloads (kind, scope_key);

-- roles_readonly.sql's ALTER DEFAULT PRIVILEGES does cover matviews, so this is
-- belt-and-braces — but it is belt-and-braces 119, 121, 122 and 123 all wear, and it matters
-- here for the reason the header gives: the route catches its own errors and degrades to the
-- live functions, so a database where the default privileges were never applied would not fail
-- loudly. It would serve the slow path forever, correctly, with nothing red anywhere.
GRANT SELECT ON procurement_payloads TO app_readonly;
