-- ⚠️⚠️ OFFLINE ONLY. THIS FUNCTION IS NOT SERVED, AND NO LIVE-SERVING BUDGET APPLIES TO IT.
--
-- It has exactly TWO consumers, both offline. The SQL call site is
-- `scripts/db/gen_procurement/hub_stats_source.ts`, shared by `npm run db:gen-hub-stats`
-- (which writes the committed artifact `data/procurement/derived/hub_stats.json`) and by
-- `scripts/db/tests/procurement_hub_stats.data.test.ts` (which re-derives from it to check
-- that artifact against the corpus). Verified 2026-08-27: zero references in `functions/`,
-- zero in `ai/`. Nothing reaches it on a request path.
--
-- WHY THE BANNER EXISTS. Every other signal on this function says "served": it lives in
-- schema/pg/ beside the serving functions, it is `LANGUAGE sql STABLE` returning jsonb, it
-- is named like `agri_hub_stats` / `funds_hub_stats` / `budget_hub_stats` (which ARE served),
-- and it GRANTs EXECUTE to the serving role. A code review with database access read all of
-- that, measured the function correctly at 3,206 buffers, and reported it as a live-serving
-- regression "over the ~2,000 ceiling" — a ceiling that is the dashboard-hub budget for calls
-- made on every page view. The measurement was right and the conclusion was a category error,
-- which cost a full investigation to undo.
--
-- WHAT IT ACTUALLY COSTS, measured 2026-08-27 on the local docker Postgres:
--
--   procurement_hub_counts(NULL,NULL)   3,206 buffers warm / 3,760 cold   24-67 ms
--   a windowed scope (y:2024)             941 buffers                      6.7 ms
--   all 30 scopes = one generator run  ~30,500 buffers                   ~200 ms
--
-- i.e. ~200 ms of database time, once per `db:refresh`, a chain that runs for hours. There is
-- nothing here to optimise, and the arm that dominates is already optimal: 3,098 of the 3,206
-- is the `tenders` count, a Parallel Index Only Scan on idx_tenders_order with
-- `Heap Fetches: 0`, reading 237,942 index entries because that is what counting 237,942 rows
-- costs. No index makes an exact count(*) cheaper.
--
-- ⚠️ DO NOT "FIX" THIS BY PRECOMPUTING IT. A scope-keyed matview would add a refresh
-- dependency on five tables to save 200 ms of offline time — machinery for nothing, and one
-- more thing to go stale. Plan: docs/plans/procurement-hub-stats-freshness-v1.md §0.
--
-- ⚠️ SHIPPING A CHANGE TO THIS FILE also means regenerating and PUBLISHING the artifact:
-- `npm run db:gen-hub-stats`, commit, then
-- `npm run bucket:sync:paths -- procurement/derived/hub_stats.json`. The browser reads the
-- blob from GCS, not from the repo, so a commit alone leaves production on the old numbers.
-- `scripts/db/tests/procurement_hub_stats.data.test.ts` gates disk-vs-corpus and
-- `npm run db:check-generated` gates disk-vs-bucket; they catch different halves.
--
-- Lightweight scoped counts for the /procurement HUB stat tiles that aren't in
-- the procurement_overview payload. Kept OUT of procurement_overview (a hot,
-- cached function) so the generator can fetch these independently and the overview
-- stays lean.
--
-- ⚠️ THE SENTENCE ABOVE AND THE ONE BELOW PREDATE THE BANNER and are kept for the design
-- reasoning they carry, not as a description of how the numbers reach a reader. Both were
-- written when the hub was expected to CALL these live; it does not, and has not since the
-- blob shipped — it downloads `hub_stats.json` from GCS. Read "hub load" below as
-- "generator run".
--
--   tenders — windowed by publication_date; idx_tenders_order
--             (publication_date, unp) makes the range sargable.
--   appeals — windowed by kzk_appeals.complaint_date (small table).
--   ngos    — all-time distinct funded NGOs: ngo_funding has NO date column
--             (external NGO funding isn't parliament-scoped), so this ignores
--             the window by construction.
--
-- Deliberately EXCLUDES flags + by-place: the risk feed (029) and settlement
-- rollup (030) are heavy per-window aggregations with no cheap windowed cache,
-- so counting them HERE would tax every caller. ⚠️ That is a statement about this
-- FUNCTION's scope, not about the artifact: `hub_stats_source.ts` calls 029 and 030 itself
-- and the blob DOES carry `flags` and `places` — computed offline, which is exactly where
-- their cost is affordable and why the split stands.
--
-- Sargable COALESCE bounds (NOT `p_from IS NULL OR …`) — same rule as
-- procurement_overview (025). Depends on tenders (009), kzk_appeals (042),
-- ngo_funding (040). EXECUTE → app_readonly.
--
-- ⚠️ A ROW WITH NO DATE IS EXCLUDED FROM EVERY SCOPE, INCLUDING `all`. Both columns are
-- TEXT, so `publication_date >= COALESCE(p_from,'')` is NULL for a NULL date and the row
-- fails the predicate everywhere — and `all` is the scope a reader takes to mean "the whole
-- corpus", so the tile would under-count with nothing failing. There are **0 NULL and 0
-- empty** in 237,942 tenders and 0 in 8,007 appeals today (measured 2026-08-27), so this is
-- a premise rather than a bug — and it is now a CHECKED premise:
-- `procurement_hub_stats.data.test.ts` asserts the count is 0/0 and says, if it ever is not,
-- to backfill the dates or give this function an explicit bucket rather than widening the
-- assertion. Do not read the empty-string sentinel `'9999-99-99'` as a date: it is a TEXT
-- upper bound and only works because these columns are text.
--
-- ⚠️ APPLIED BY scripts/db/gen_procurement/hub_stats.ts (`npm run db:gen-hub-stats`),
-- which is its only APPLIER — the callers are the two named in the banner, and the SQL
-- call site moved to hub_stats_source.ts in 2026-08. Until 2026-08-04 no script in the repo
-- applied this file at all, so the function existed only where it had been applied by
-- hand — and hub_stats.ts exits non-zero on a missing function, which would have
-- aborted the &&-chained db:refresh on a fresh clone.
--
-- The GRANT is guarded on the role existing so this still applies on a cold bootstrap
-- where roles_readonly.sql has never run (same reason + same shape as 117_place_dim.sql
-- and 130_kzk_decisions.sql). Unguarded it raises 42704, and since a migration is sent
-- as ONE implicit transaction that rolls the whole file back — leaving no function at
-- all, which is the exact fresh-clone abort this applier exists to prevent.
--
-- ⚠️ THAT GRANT IS KEPT DELIBERATELY AND IT CONFERS NOTHING — read it as house style, NOT
-- as evidence this function is served (see the banner at the top; it is the signal that
-- misled a reviewer into reporting an offline generator as a live-serving regression).
-- Postgres grants EXECUTE on a function to PUBLIC by default, so app_readonly could already
-- call this with or without the line: measured, `proacl` is
-- `{=X/postgres,postgres=X/postgres,app_readonly=X/postgres}` — the bare `=X` IS the PUBLIC
-- grant. Dropping it would therefore restrict nothing while making this the one migration in
-- the tree that omits the pattern, and `api_readonly_grants.data.test.ts` only checks the
-- forward direction (relations the API reads), so nothing would flag either choice.

SET check_function_bodies = off;
DROP FUNCTION IF EXISTS procurement_hub_counts(text, text);
CREATE OR REPLACE FUNCTION procurement_hub_counts(
  p_from text DEFAULT NULL,
  p_to   text DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'tenders', (
      SELECT count(*)::int FROM tenders
      WHERE publication_date >= COALESCE(p_from, '')
        AND publication_date <  COALESCE(p_to, '9999-99-99')
    ),
    'appeals', (
      SELECT count(*)::int FROM kzk_appeals
      WHERE complaint_date >= COALESCE(p_from, '')
        AND complaint_date <  COALESCE(p_to, '9999-99-99')
    ),
    'ngos', (
      SELECT count(DISTINCT eik)::int FROM ngo_funding WHERE eik IS NOT NULL
    )
  );
$$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT EXECUTE ON FUNCTION procurement_hub_counts(text, text) TO app_readonly;
  END IF;
END $$;
