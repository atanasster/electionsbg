-- Commerce-Registry (TR) search tables — companies + officers, folded for name
-- search. Populated from raw_data/tr/state.sqlite by load_tr_pg.ts. Officers are
-- deduped to one row per (uic, name) with the roles aggregated + an active flag.
-- Indexes are built by the loader AFTER the bulk insert (a one-shot GIN build is
-- far cheaper than incremental). Requires 000_search_fns.sql (translit_bg_latin).
-- See docs/plans/postgres-migration-v1.md (Feature 1).

DROP TABLE IF EXISTS tr_companies CASCADE;
CREATE TABLE tr_companies (
  uic            text PRIMARY KEY,
  name           text NOT NULL,
  legal_form     text,
  seat           text,
  status         text,
  funds_amount   numeric,     -- registered capital (капитал)
  funds_currency text,
  last_updated   timestamptz, -- TR registry change date (for recent_updates)
  name_fold      text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED,
  -- Derived classification (needs tr_entity_class/tr_ngo_type from 000). NGO
  -- surface = entity_class IN ('ngo_assoc','ngo_found','chitalishte'); the
  -- feature filters/segments on these. ngo_type is a best-effort sub-type.
  entity_class   text GENERATED ALWAYS AS (tr_entity_class(legal_form)) STORED,
  ngo_type       text GENERATED ALWAYS AS (tr_ngo_type(name, legal_form)) STORED
);

-- ЮЛНЦ metadata (цели/средства/полза), one row per NGO. Loaded from the new
-- state.sqlite columns by load_tr_pg.ts. Kept out of tr_companies (long text)
-- to keep the search table lean.
DROP TABLE IF EXISTS ngo_details CASCADE;
CREATE TABLE ngo_details (
  uic             text PRIMARY KEY,
  public_benefit  boolean,   -- определено за общественополезна дейност
  private_benefit boolean,   -- определено за частна дейност
  objectives      text,      -- цели
  means           text       -- средства за постигане на целите
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
  uic            text NOT NULL,
  name           text NOT NULL,
  role           text,
  country        text,         -- jurisdiction of the person (foreign-control signal)
  share          numeric,      -- ownership % (derived from the capital shares)
  share_amount   numeric,      -- raw declared capital share (дял)
  share_currency text,
  added_at       timestamptz,  -- role opened
  erased_at      timestamptz,  -- role closed (NULL = current)
  name_fold      text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED
);
