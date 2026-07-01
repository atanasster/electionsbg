-- Feature 2: "last ingestion" — which contracts were added by the most recent
-- load. first-seen is tracked in a SIDE table so the hot contracts load stays a
-- fast TRUNCATE + bulk insert (unchanged, generators untouched); this table
-- persists across truncates. A key that already exists keeps its original batch,
-- so batch_id = "the load that first saw this contract".
-- See docs/plans/postgres-migration-v1.md (Feature 2).

CREATE TABLE IF NOT EXISTS ingest_batches (
  id         serial PRIMARY KEY,
  loaded_at  timestamptz NOT NULL DEFAULT now(),
  source     text NOT NULL,          -- e.g. 'shards'
  rows_total integer,                -- corpus size at this load
  rows_new   integer                 -- keys first seen in this load
);

CREATE TABLE IF NOT EXISTS contract_first_seen (
  key           text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  batch_id      integer NOT NULL REFERENCES ingest_batches(id)
);
CREATE INDEX IF NOT EXISTS idx_cfs_batch ON contract_first_seen(batch_id);

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
