-- 123_procurement_settlement_payloads.sql — the per-settlement procurement payload,
-- precomputed per scope. Behind /api/db/procurement-settlement (the settlement page and
-- the My-Area tiles).
--
-- WHY. procurement_settlement_detail(ekatte, from, to) ran live on every settlement page
-- load. On the largest settlements it exceeded the 10 s statement_timeout the /api/db pool
-- sets (functions/index.js), Postgres aborted it and the route returned 500 — measured on
-- prod at 10.009 s for София (68134), twice, 0.7 ms apart. That precision is a configured
-- limit, not organic cost.
--
-- It is not an indexing problem. Local, warm, the same call is 401 ms and 304 ms of that
-- is ONE GROUP BY over София's 64k contracts to build the awarders list. No index removes
-- a grouped aggregate, so the only way to stop paying it per request is to stop computing
-- it per request.
--
-- WHY THE WHOLE FAN-OUT, not just the three settlements that 500: the fan-out is cheap.
-- 869 seated settlements × 30 scopes = 26,070 rows / 22 MB. LOCAL, warm buffers: build
-- ~9.3 s, REFRESH … CONCURRENTLY ~9.9 s — cheaper than 119 (~12 s) and 122 (~20 s),
-- measured the same way. Special-casing the big three would buy ~22 MB and cost a second
-- code path that only ever executes for the settlements nobody tests.
--
-- CLOUD SQL IS NOT MEASURED and will be materially slower — the whole premise of this
-- migration is that the same function call is 401 ms local and 10.0 s on prod against a
-- cold buffer cache. A bulk build warms its own buffers as it goes, so the factor is
-- nowhere near that 25×, but it is not 1× either. Expect the cloud refresh in minutes
-- rather than seconds on db:load:procurement-scopes:pg:cloud, and record the real number
-- on the first run.
--
-- IT DOES NOT RE-IMPLEMENT THE AGGREGATION. Like 119, it unnests the function 030 already
-- defines, so a change to the methodology — which buyers count as local-tier, how a tier is
-- labelled, which place fields the hero carries — lands in 030 alone and this follows.
--
-- DEPENDS ON THREE INPUTS, and the last two are the ones that go stale quietly:
--   contracts (001)        the money
--   awarder_seats          WHICH buyers are seated in a settlement
--   place_dim (117)        the whole place hero — nameEn, loc, obshtina/oblast codes
-- The place JOINs inside 030 are LEFT and degrade to the Bulgarian awarder_seats strings,
-- which is correct live but is BAKED IN here: a refresh that runs while place_dim is empty
-- stores 26,070 rows with no English name, no centroid and a breadcrumb that cannot link
-- up, and they stay that way until the next refresh. This is why load_awarder_seats_pg and
-- load_place_dim_pg refresh the scoped precomputes themselves and not only the scopes
-- loader does: a STANDALONE reload of either input would otherwise leave this matview stale
-- with nothing red anywhere.
--
-- REFRESHED CONCURRENTLY (the UNIQUE index below is what makes that legal) — on every path
-- that refreshes WITHOUT re-applying this file: the contracts reload and the awarder_seats /
-- place_dim reloads. The one exception is the scopes loader, which applies this file first,
-- and the DROP + CREATE … WITH NO DATA below means its refresh always meets a
-- freshly-created, unpopulated matview: it raises 0A000 and takes the PLAIN form, every run,
-- not just the first (refreshScopedPrecomputes, scripts/db/lib/scopedMatviews.ts, handles
-- the fallback). Inherited from 119/122, which have the same shape.
--
-- That is tolerable here in a way it would not be elsewhere, because the route degrades to
-- the live function rather than erroring — but only if it degrades FAST. A plain REFRESH
-- holds an AccessExclusiveLock, so a settlement page landing mid-rebuild would otherwise
-- queue behind it, burn the 10 s statement_timeout waiting, and reach the live path with no
-- budget left. The route therefore probes this matview under a short lock_timeout and
-- treats the lock error as a miss (functions/db_routes.js).
--
-- See docs/plans/procurement-settlement-precompute-v1.md.

DROP MATERIALIZED VIEW IF EXISTS procurement_settlement_payloads;
-- WITH NO DATA: this file is applied inside one implicit transaction, so a populating
-- CREATE would hold an AccessExclusiveLock for the whole build AND then be recomputed by
-- the loader's REFRESH straight after — paying twice, half of it under exactly the lock
-- CONCURRENTLY exists to avoid. The loader populates it; the route falls back to the live
-- function until it does.
CREATE MATERIALIZED VIEW procurement_settlement_payloads AS
SELECT
  s.scope_key,
  x.ekatte,
  procurement_settlement_detail(x.ekatte, s.date_from, s.date_to) AS payload
FROM procurement_scopes s
CROSS JOIN (
  -- The same seat predicate 030 applies inside the function. A settlement with a seated
  -- buyer but no contracts in the window is kept deliberately: the function returns
  -- contractCount 0 rather than NULL for it (NULL means "no seated buyer at all", a
  -- property of awarder_seats and not of the window), so the page shows "nothing in this
  -- period" instead of its not-found branch.
  SELECT DISTINCT ekatte
  FROM awarder_seats
  WHERE source = 'geo' AND is_local_hq AND ekatte IS NOT NULL
) x
WITH NO DATA;

-- REQUIRED for REFRESH … CONCURRENTLY, and the natural key besides. This is the WHOLE
-- index list: unlike 119, which is paginated, sorted and searched, this matview is only
-- ever read by one query shape — a (scope_key, ekatte) point lookup — so there is nothing
-- else to index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_psp_scope_ekatte
  ON procurement_settlement_payloads (scope_key, ekatte);

-- roles_readonly.sql's ALTER DEFAULT PRIVILEGES does cover matviews, so this is
-- belt-and-braces — but it is belt-and-braces 119, 121 and 122 all wear, and it matters
-- more here: the route catches its own errors and degrades to the live function, so a
-- database where the default privileges were never applied would not fail loudly. It would
-- serve the slow path forever, correctly, with nothing red anywhere.
GRANT SELECT ON procurement_settlement_payloads TO app_readonly;
