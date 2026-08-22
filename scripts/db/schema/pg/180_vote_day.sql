-- vote_day — the per-sitting facts that belong to the DAY rather than to an item.
-- Plan: docs/plans/json-retirement-v2.md Tier 1 (decision D2).
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- WHY THIS TABLE EXISTS AT ALL
--
-- /api/db/session was written to replace the 290 MB parliament/votes/sessions/ tree, and it
-- reads `vote_item` — which carries the agenda and the tallies and nothing else. Three
-- fields on the day file have no column anywhere:
--
--   stenogram_id   parliament.bg's own id for the sitting's stenographic record
--   scraped_at     when the scraper last read that sitting
--   pdf_url        the per-MP roll-call PDF on parliament.bg
--
-- `pdf_url` is the one that matters to a reader: SessionScreen renders it as the "Виж в
-- parliament.bg" link, which is the page's ONLY route back to the primary source. Migrating
-- the day route without this table would have deleted the source attribution from every
-- session page — silently, since a missing optional link renders as nothing at all.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- KEYED (ns, date), NOT date ALONE.
--
-- `vote_item`'s own UNIQUE is (ns, date, item_no), which PERMITS one date to carry two
-- parliaments' items — a dissolution and a first sitting on the same day. It has not
-- happened, and /api/db/session already reports `spansNs` rather than assuming it cannot.
-- A date-only key here would make that unrepresentable in the one table whose job is to
-- describe the sitting.
--
-- ⚠️ NO FOREIGN KEY TO vote_item. The load order is items-then-days within one transaction,
-- so an FK would hold either way — but `vote_item` is stage-MERGED (see load_rollcall_pg's
-- header) and an FK from a truncate-and-reload table onto a merged one is the shape that
-- turns a routine reload into a dependency failure. The loader asserts the join instead.

CREATE TABLE IF NOT EXISTS vote_day (
  ns            smallint NOT NULL,
  date          date     NOT NULL,
  stenogram_id  integer,
  scraped_at    timestamptz,
  pdf_url       text,
  -- Ingest-side provenance: when this ROW was last written, as distinct from when the
  -- SITTING was scraped. `scraped_at` is a fact about parliament.bg; this is a fact about
  -- us, and the two answer different questions when a reload republishes an old sitting.
  refreshed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ns, date)
);

COMMENT ON TABLE vote_day IS
  'Per-sitting facts that belong to the day rather than to an item — the stenogram id, the '
  'scrape time and the roll-call PDF. Fills the gap between vote_item (agenda + tallies) and '
  'what parliament/votes/sessions/<date>.json carried.';

COMMENT ON COLUMN vote_day.pdf_url IS
  'The per-MP roll-call PDF on parliament.bg. SessionScreen''s only link back to the primary '
  'source. NULL means no scrape has ever seen one — the loader COALESCEs, so a later scrape '
  'that omits the link keeps the stored value rather than deleting it. The cost is that a '
  'WITHDRAWN PDF stays served as a dead link; see the loader for why that trade is the right '
  'way round here and the opposite of price_last_seen''s.';

COMMENT ON COLUMN vote_day.refreshed_at IS
  'When THIS ROW was last written by db:load:rollcall:pg — our provenance, not the source''s. '
  'Read by the attendance/cohesion screens as the "computed at" stamp they used to take from '
  'the derived JSON artifacts'' computedAt field.';

-- The attendance and cohesion screens want ONE timestamp for "as of when", not a per-sitting
-- one. Exposed as a function so those callers cannot accidentally take max(scraped_at) — the
-- source's clock — when what they mean is ours.
CREATE OR REPLACE FUNCTION rollcall_refreshed_at()
RETURNS timestamptz
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$ SELECT max(refreshed_at) FROM vote_day $$;

COMMENT ON FUNCTION rollcall_refreshed_at() IS
  'The newest vote_day.refreshed_at — the roll-call corpus'' own "computed at". NULL on a '
  'database whose rollcall loader has never run, which every consumer must render as absent '
  'rather than as an epoch.';

-- Role-guarded — see 150/151. roles_readonly.sql is a one-time manual step on Cloud SQL and
-- exec() sends a migration as ONE transaction, so a bare GRANT raises 42704 and rolls the
-- whole file back on a database that never ran it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON vote_day TO app_readonly;
    GRANT EXECUTE ON FUNCTION rollcall_refreshed_at() TO app_readonly;
  ELSE
    RAISE WARNING 'app_readonly is absent — vote_day has no ACL; run roles_readonly.sql then re-apply 180';
  END IF;
END $$;
