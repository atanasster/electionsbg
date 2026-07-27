-- Roster-file header scalars for /api/db/mp-roster (persons-pg-retirement-v1 T2.4).
-- The MP rows themselves come from mp_profile (104); this one-row table carries the
-- three top-level fields of data/parliament/index.json that are NOT per-MP:
--
--   current_ns — the scraped label, e.g. "52-ро Народно събрание". NOT derivable from
--                the number: Bulgarian ordinals vary (52-ро vs 50-о), and consumers use
--                it both verbatim (a heading) and via /^\d+/ (the current folder). So it
--                must be stored, not reconstructed.
--   scraped_at — kept as the raw ISO string the scraper wrote (passthrough display).
--   total      — the scraper's roster count (rawTotal-derived), for the file header.
--
-- Singleton: the boolean PK + CHECK pins it to a single row (id = true).

CREATE TABLE IF NOT EXISTS mp_roster_meta (
  id         boolean PRIMARY KEY DEFAULT true,
  current_ns text    NOT NULL,
  scraped_at text,
  total      integer NOT NULL,
  CONSTRAINT mp_roster_meta_singleton CHECK (id)
);
