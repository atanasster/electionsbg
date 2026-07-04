-- Feature 2: "last ingestion" — which contracts were added by the most recent
-- load. first-seen is tracked in a SIDE table so the hot contracts load stays a
-- fast TRUNCATE + bulk insert (unchanged, generators untouched); this table
-- persists across truncates. A key that already exists keeps its original batch,
-- so batch_id = "the load that first saw this contract".
-- See docs/plans/postgres-migration-v1.md (Feature 2).
--
-- Generalised (2026-07): the same batch + first-seen machinery now backs the
-- user-facing "what changed" changelog (recent_updates, 007) for every PG-loaded
-- dataset — tenders, EU fund projects, NGO funding — not just contracts. A load
-- whose new-row delta is small records a per-row changelog entry; a load above
-- INGEST_SUMMARY_THRESHOLD (a bulk backfill / first cold load) records only a
-- one-line SUMMARY so the feed never floods with 100k+ per-row records. The
-- decision is per-load (mode below), so day-to-day is per-row and only bulk
-- ingests summarise. Applied by every PG loader that writes a batch, so the
-- last_ingested_contracts function (referencing contracts) must tolerate being
-- created on a contracts-less DB.
SET check_function_bodies = off;

CREATE TABLE IF NOT EXISTS ingest_batches (
  id         serial PRIMARY KEY,
  loaded_at  timestamptz NOT NULL DEFAULT now(),
  source     text NOT NULL,          -- e.g. 'shards', 'tender', 'fund_project', 'ngo_funding'
  rows_total integer,                -- corpus size at this load
  rows_new   integer,               -- keys first seen in this load
  -- 'detail' → the load's new rows are surfaced per-row in recent_updates;
  -- 'summary' → the delta exceeded the threshold, so only a one-line summary is.
  mode       text NOT NULL DEFAULT 'detail'
);
-- Idempotent upgrade for DBs created before `mode` existed.
ALTER TABLE ingest_batches ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'detail';

-- Generic per-row first-seen changelog for datasets beyond contracts (which keep
-- their own contract_first_seen + last_ingested_contracts below). Keyed by a
-- STABLE natural key per source so it survives each loader's TRUNCATE+reload and
-- only genuinely-new rows count. name/detail/amount_eur snapshot what the row
-- looked like when first seen (an immutable changelog record, independent of
-- later edits or deletes); they are populated only for 'detail' batches — a
-- 'summary' batch stores key+batch_id alone, so a bulk load never materialises
-- 100k+ rich rows.
CREATE TABLE IF NOT EXISTS ingest_first_seen (
  source        text NOT NULL,
  key           text NOT NULL,
  name          text,
  detail        text,
  amount_eur    double precision,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  batch_id      integer NOT NULL REFERENCES ingest_batches(id),
  PRIMARY KEY (source, key)
);
CREATE INDEX IF NOT EXISTS idx_ifs_seen  ON ingest_first_seen (first_seen_at);
CREATE INDEX IF NOT EXISTS idx_ifs_batch ON ingest_first_seen (batch_id);

CREATE TABLE IF NOT EXISTS contract_first_seen (
  key           text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  batch_id      integer NOT NULL REFERENCES ingest_batches(id)
);
CREATE INDEX IF NOT EXISTS idx_cfs_batch ON contract_first_seen(batch_id);
CREATE INDEX IF NOT EXISTS idx_cfs_seen ON contract_first_seen(first_seen_at);

-- The contracts first seen in the latest 'shards' load, most recent first.
CREATE OR REPLACE FUNCTION last_ingested_contracts(lim int DEFAULT 200)
RETURNS TABLE (
  key             text,
  date            text,
  contractor_eik  text,
  contractor_name text,
  awarder_name    text,
  amount_eur      double precision,
  title           text,
  first_seen_at   timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT c.key, c.date, c.contractor_eik, c.contractor_name, c.awarder_name,
         c.amount_eur, c.title, f.first_seen_at
  FROM contracts c
  JOIN contract_first_seen f USING (key)
  WHERE f.batch_id = (SELECT max(id) FROM ingest_batches WHERE source = 'shards')
  ORDER BY c.date DESC, c.key
  LIMIT lim;
$$;
