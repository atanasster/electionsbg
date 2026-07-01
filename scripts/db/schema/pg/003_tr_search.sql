-- Commerce-Registry (TR) search tables — companies + officers, folded for name
-- search. Populated from raw_data/tr/state.sqlite by load_tr_pg.ts. Officers are
-- deduped to one row per (uic, name) with the roles aggregated + an active flag.
-- Indexes are built by the loader AFTER the bulk insert (a one-shot GIN build is
-- far cheaper than incremental). Requires 000_search_fns.sql (translit_bg_latin).
-- See docs/plans/postgres-migration-v1.md (Feature 1).

DROP TABLE IF EXISTS tr_companies CASCADE;
CREATE TABLE tr_companies (
  uic        text PRIMARY KEY,
  name       text NOT NULL,
  legal_form text,
  seat       text,
  status     text,
  name_fold  text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED
);

DROP TABLE IF EXISTS tr_officers CASCADE;
CREATE TABLE tr_officers (
  uic       text NOT NULL,
  name      text NOT NULL,
  roles     text,
  active    integer,
  name_fold text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED
);
