-- Commerce-Registry (TR) search tables — companies + officers, folded for name
-- search. Populated from raw_data/tr/state.sqlite by load_tr_pg.ts. Officers are
-- deduped to one row per (uic, name) with the roles aggregated + an active flag.
-- Indexes are built by the loader AFTER the bulk insert (a one-shot GIN build is
-- far cheaper than incremental). Requires 000_search_fns.sql (translit_bg_latin).
-- See docs/plans/postgres-migration-v1.md (Feature 1).

DROP TABLE IF EXISTS tr_companies CASCADE;
CREATE TABLE tr_companies (
  uic          text PRIMARY KEY,
  name         text NOT NULL,
  legal_form   text,
  seat         text,
  status       text,
  last_updated timestamptz,  -- TR registry change date (for recent_updates)
  name_fold    text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED
);

DROP TABLE IF EXISTS tr_officers CASCADE;
CREATE TABLE tr_officers (
  uic        text NOT NULL,
  name       text NOT NULL,
  roles      text,
  active     integer,
  changed_at timestamptz,  -- latest added_at/erased_at across this (uic,name)
  name_fold  text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED
);

-- Raw per-role records (one row per company × role) so the person page can show
-- history: from-date (added_at), to-date (erased_at), current-vs-former, and the
-- ownership share. NOTE: our TR ingest does not yet capture `share` (0/1M in the
-- source) — the column is here, ready, and populated once the TR parser extracts
-- ownership %. See docs/plans/postgres-migration-v1.md.
DROP TABLE IF EXISTS tr_person_roles CASCADE;
CREATE TABLE tr_person_roles (
  uic       text NOT NULL,
  name      text NOT NULL,
  role      text,
  share     numeric,       -- ownership % (дял) — nullable; pending TR-parser support
  added_at  timestamptz,   -- role opened
  erased_at timestamptz,   -- role closed (NULL = current)
  name_fold text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED
);
