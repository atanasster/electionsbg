-- Commerce-Registry (TR) search tables — companies + officers, folded for name
-- search. Populated from raw_data/tr/state.sqlite by load_tr_pg.ts. Officers are
-- deduped to one row per (uic, name) with the roles aggregated + an active flag.
-- Indexes are built by the loader AFTER the bulk insert (a one-shot GIN build is
-- far cheaper than incremental). Requires 000_search_fns.sql (translit_bg_latin).
-- See docs/plans/postgres-migration-v1.md (Feature 1).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THIS FILE MUST NEVER DROP ITS TABLES. Read this before adding a column.
--
-- Until 2026-08-10 each table opened with `DROP TABLE IF EXISTS … CASCADE`, and
-- load_tr_pg.ts applies this file on EVERY run. Three matviews owned by OTHER
-- migrations read these tables, so every `db:load:tr:pg` deleted them and the
-- loader still exited 0:
--
--   person_browse_table       (120_person_browse.sql)        — the ENTIRE /persons browser
--   declaration_stake_company (096_stake_procurement.sql)
--   company_officer_counts    (071_magistrate_connections.sql)
--
-- Reproduced locally: relation count 177 → 174, and the next loader in the chain
-- failed with `relation "person_browse_table" does not exist` (42P01).
--
-- It is the same structural rule 077/145 carry (a loader-applied migration may
-- not destroy an object another migration owns), but with the OPPOSITE and more
-- dangerous failure mode. A DROP without CASCADE REFUSES — 2BP01, loud, and the
-- loader aborts. CASCADE SUCCEEDS: nothing in the loader output and no row count
-- reports the loss. `db:refresh` happens to sequence db:load:persons-browse:pg
-- after db:load:tr:pg, so a full local refresh silently self-heals and hides it,
-- while a STANDALONE `db:load:tr:pg:cloud` — the documented routine TR publish —
-- drops person_browse_table on Cloud SQL with nothing there to recreate it.
--
-- CASCADE is never the way out of a dependency error here, for the same reason
-- 077's header gives: the loaders that would recreate the dependents are not on
-- the path that does the dropping.
--
-- ───────────────────────────────────────────────────────────────────────────
-- CONSEQUENCE FOR SCHEMA EDITS: every column appears TWICE, on purpose.
--
-- `CREATE TABLE IF NOT EXISTS` is a no-op on a warm database, so on its own it
-- would silently never apply a new column — trading a loud data loss for a quiet
-- schema drift, which is not a trade worth making. Each column is therefore also
-- listed in the RECONCILE block at the foot of this file as
-- `ADD COLUMN IF NOT EXISTS`, which is what actually reaches a warm database.
-- tr_search_shape.test.ts fails when the two lists disagree, so the duplication
-- is machine-enforced rather than remembered.
--
-- The reconcile lines carry the type and any GENERATED expression, but NOT
-- `PRIMARY KEY` / `NOT NULL`: a genuinely-new column on a 1M-row populated table
-- cannot take a NOT NULL without a default, and the ALTER would abort the whole
-- file (exec() sends a migration as one implicit transaction). Constraints are
-- for fresh databases; changing one on a warm table needs a hand-written ALTER
-- here, and so does any change to a column's TYPE or GENERATED expression —
-- IF NOT EXISTS cannot retype a warm column. 142_open_calls.sql has a worked
-- example of that reconcile shape.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tr_companies (
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
CREATE TABLE IF NOT EXISTS ngo_details (
  uic             text PRIMARY KEY,
  public_benefit  boolean,   -- определено за общественополезна дейност
  private_benefit boolean,   -- определено за частна дейност
  objectives      text,      -- цели
  means           text       -- средства за постигане на целите
);

CREATE TABLE IF NOT EXISTS tr_officers (
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
CREATE TABLE IF NOT EXISTS tr_person_roles (
  uic            text NOT NULL,
  name           text NOT NULL,
  role           text,
  country        text,         -- jurisdiction of the person (foreign-control signal)
  share          numeric,      -- ownership % (derived from the capital shares)
  share_amount   numeric,      -- raw declared capital share (дял)
  share_currency text,
  added_at       timestamptz,  -- role opened
  erased_at      timestamptz,  -- role closed (NULL = current)
  position_label text,         -- registry position within the body (председател на УС / секретар / член) — populated mostly on ngo_representative rows
  name_fold      text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED
);

-- ───────────────────────────────────────────────────────────────────────────
-- SHAPE RECONCILE — what actually reaches a warm database.
--
-- One line per column above, in the same order. See the header: the CREATEs are
-- no-ops once the tables exist, so without these a new column would land on a
-- fresh clone and on nothing else. Keep the two lists in step —
-- tr_search_shape.test.ts is the gate, and it also checks that a column declared
-- GENERATED above is declared GENERATED here.
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE tr_companies ADD COLUMN IF NOT EXISTS uic            text;
ALTER TABLE tr_companies ADD COLUMN IF NOT EXISTS name           text;
ALTER TABLE tr_companies ADD COLUMN IF NOT EXISTS legal_form     text;
ALTER TABLE tr_companies ADD COLUMN IF NOT EXISTS seat           text;
ALTER TABLE tr_companies ADD COLUMN IF NOT EXISTS status         text;
ALTER TABLE tr_companies ADD COLUMN IF NOT EXISTS funds_amount   numeric;
ALTER TABLE tr_companies ADD COLUMN IF NOT EXISTS funds_currency text;
ALTER TABLE tr_companies ADD COLUMN IF NOT EXISTS last_updated   timestamptz;
ALTER TABLE tr_companies ADD COLUMN IF NOT EXISTS name_fold      text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED;
ALTER TABLE tr_companies ADD COLUMN IF NOT EXISTS entity_class   text GENERATED ALWAYS AS (tr_entity_class(legal_form)) STORED;
ALTER TABLE tr_companies ADD COLUMN IF NOT EXISTS ngo_type       text GENERATED ALWAYS AS (tr_ngo_type(name, legal_form)) STORED;

ALTER TABLE ngo_details ADD COLUMN IF NOT EXISTS uic             text;
ALTER TABLE ngo_details ADD COLUMN IF NOT EXISTS public_benefit  boolean;
ALTER TABLE ngo_details ADD COLUMN IF NOT EXISTS private_benefit boolean;
ALTER TABLE ngo_details ADD COLUMN IF NOT EXISTS objectives      text;
ALTER TABLE ngo_details ADD COLUMN IF NOT EXISTS means           text;

ALTER TABLE tr_officers ADD COLUMN IF NOT EXISTS uic        text;
ALTER TABLE tr_officers ADD COLUMN IF NOT EXISTS name       text;
ALTER TABLE tr_officers ADD COLUMN IF NOT EXISTS roles      text;
ALTER TABLE tr_officers ADD COLUMN IF NOT EXISTS active     integer;
ALTER TABLE tr_officers ADD COLUMN IF NOT EXISTS changed_at timestamptz;
ALTER TABLE tr_officers ADD COLUMN IF NOT EXISTS name_fold  text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED;

ALTER TABLE tr_person_roles ADD COLUMN IF NOT EXISTS uic            text;
ALTER TABLE tr_person_roles ADD COLUMN IF NOT EXISTS name           text;
ALTER TABLE tr_person_roles ADD COLUMN IF NOT EXISTS role           text;
ALTER TABLE tr_person_roles ADD COLUMN IF NOT EXISTS country        text;
ALTER TABLE tr_person_roles ADD COLUMN IF NOT EXISTS share          numeric;
ALTER TABLE tr_person_roles ADD COLUMN IF NOT EXISTS share_amount   numeric;
ALTER TABLE tr_person_roles ADD COLUMN IF NOT EXISTS share_currency text;
ALTER TABLE tr_person_roles ADD COLUMN IF NOT EXISTS added_at       timestamptz;
ALTER TABLE tr_person_roles ADD COLUMN IF NOT EXISTS erased_at      timestamptz;
ALTER TABLE tr_person_roles ADD COLUMN IF NOT EXISTS position_label text;
ALTER TABLE tr_person_roles ADD COLUMN IF NOT EXISTS name_fold      text GENERATED ALWAYS AS (translit_bg_latin(name)) STORED;
