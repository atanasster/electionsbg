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
-- listed in the RECONCILE block below the table definitions as
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
-- ownership share. See docs/plans/postgres-migration-v1.md.
--
-- ⚠️ ONE ROW PER FILING, NOT PER PERSON, and a row is never erased just because
-- a later filing supersedes it — see the OWNERSHIP SHARE block at the foot of
-- this file before writing any query that reads these rows as "who owns this
-- company today".
CREATE TABLE IF NOT EXISTS tr_person_roles (
  uic            text NOT NULL,
  name           text NOT NULL,
  role           text,
  country        text,         -- jurisdiction of the person (foreign-control signal)
  share          numeric,      -- the FEED's own % — WRONG; see tr_owner_share below
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

-- ───────────────────────────────────────────────────────────────────────────
-- OWNERSHIP SHARE — the ONE definition of what percentage of a company a
-- person owns. `tr_owner_share` is that definition; the stored
-- `tr_person_roles.share` is the feed's own derivation and is wrong for the
-- reason below.
--
-- ⚠️ NOT YET SERVED. As of 2026-08-20 this view has no consumers:
-- company_officers() and person_roles() (008) and company_person_roles (022)
-- all still select the stored `share`, so /company/104119056 publishes
-- 26% / 8% today. Repointing them is T2 of docs/plans/tr-owner-share-v1.md.
--
-- ⚠️ `erased_at IS NULL` DOES NOT MEAN "current". The TR daily feed re-lists
-- the WHOLE partner set on every capital change and never erases the prior
-- vintage — 008's company_officers() has always said so, which is why it
-- collapses the rows with a DISTINCT ON. So a denominator built from "every
-- non-erased owner row" sums a company's cap table once per filing it has
-- ever made, and each owner's share comes out divided by the number of
-- vintages. Measured 2026-08-20 on the served corpus: 10,400 companies
-- understated (their displayed shares summed to a mean of 50.4% rather than
-- 100%) and 777 overstated at a mean of 200.8%.
--
-- Since 2026-01-01 it also mixes CURRENCIES. A euro re-denomination is filed
-- as a new partner vintage, so the лв and EUR cap tables are added as bare
-- numbers: БИЛЯНА ООД (104119056) published 26% + 8% against a real
-- 75.5% + 24.5%, because 6 428.58 EUR was divided by 12 564 + 4 068 (лв,
-- 2022) + 6 428.58 + 2 081.46 (EUR, 2026) = 25 142.04. 6,953 of the
-- understated companies are that pattern, and only ~35% of the 19,989
-- companies that have converted so far are affected — this GROWS with every
-- conversion rather than being a one-off.
--
-- THE RULE: a company's current cap table is its LATEST active owner vintage
-- (max added_at among non-erased partner/sole_owner rows), and each owner's
-- share is their amount over that vintage's total, normalised to EUR.
-- Validated against the registered capital (tr_companies.funds_amount) on the
-- 11,502 multi-vintage companies that carry one — the latest vintage
-- reconciles for 7,753 (67.4%) against 130 (1.1%) for the all-active sum this
-- replaces, and 6,491 (56.4%) for "latest row per person". Rows outside the
-- vintage keep their place on the page and get a NULL share: a stake we
-- cannot express as a fraction of the current capital renders "—" rather than
-- a number.
--
-- Two refusals, both deliberately the safe direction. ⚠️ ORDER MATTERS —
-- the sole_owner rule is evaluated FIRST and OUTRANKS the other, and 276,875
-- companies (79% of every company that gets a percentage) flow through that
-- precedence. So "every published percentage rests on a declared amount" is
-- false, four times in five; the missing-amount rule governs the MULTI-owner
-- path only.
--   • `sole_owner` is 100% by law when it is the company's ONLY current owner
--     row — with or without a declared amount. The count guard is what makes
--     that safe: 3,689 companies carry a sole_owner BESIDE a partner in the
--     current vintage (a superseded ЕООД filing), and answering 100% there is
--     what produced the 200.8% totals.
--   • Otherwise, ANY owner in a multi-owner current set with no share_amount
--     → NO percentage for that company. Dropping just that row would inflate
--     everyone else against a short denominator, which is this defect wearing
--     new clothes.
--
-- Result, measured over the whole corpus 2026-08-20: 348,452 of 356,221
-- companies get a percentage, and every one sums to 100% WITHIN THE RESIDUE
-- of round(…, 4) — 345,105 land on exactly 100 and the other 3,347 inside
-- 99.9945 … 100.0019, i.e. ±0.0055pp. Three equal owners are 33.3333 × 3 =
-- 99.9999, so assert the tolerance, NEVER equality.
--
-- The 7,769 that get no percentage are ALL the missing-amount refusal —
-- 7,329 with several current owners, 440 with a single partner; none is
-- refused for the sole_owner ambiguity alone, though 3,689 of them carry it
-- too. (Do not confuse that 3,689 with the 4,517 quoted for the same shape on
-- the DISPLAY dedup: different populations, and the current vintage is the
-- only one this rule sees.)
-- Gate (T3, pending): scripts/db/tests/tr_owner_share.data.test.ts.
-- ───────────────────────────────────────────────────────────────────────────

-- лв → EUR at the locked peg. The declared cell carries no currency at all on
-- pre-2026 filings ('' or NULL), so a blank means лв.
--
-- ⚠️ NEVER STRICT — and not for the reason it looks like. STRICT would return
-- NULL for a NULL AMOUNT, which is exactly what we want anyway; the argument
-- that matters is the CURRENCY. 132,886 active owner rows carry a real
-- share_amount with a NULL share_currency, so STRICT would NULL every one of
-- them and trip the missing-amount refusal across most of the corpus.
CREATE OR REPLACE FUNCTION tr_share_eur(amount numeric, currency text)
RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN amount IS NULL THEN NULL
    WHEN upper(btrim(coalesce(currency, ''))) IN ('EUR', 'EURO', 'ЕВРО', '€')
      THEN amount
    -- NULL / '' / BGN are the only other spellings the feed has ever emitted
    -- (verified across all 1,340,793 tr_person_roles rows). A NEW currency
    -- must REFUSE rather than be silently pegged: a USD amount divided by
    -- 1.95583 is a wrong percentage indistinguishable from a right one, which
    -- is the whole thing this view exists to stop. NULL here takes the
    -- company out through the missing-amount rule.
    WHEN upper(btrim(coalesce(currency, '')))
         NOT IN ('', 'BGN', 'BGL', 'ЛВ', 'ЛВ.', 'ЛЕВА', 'ЛЕВ') THEN NULL
    ELSE amount / 1.95583
  END;
$$;

-- One row per (uic, name_fold, role) in the company's current cap table, with
-- the derived percentage. Keyed to match the DISTINCT ON that 008/022 use to
-- pick which record to display, so the join can never fan a row out — but the
-- KEY IS ALL THREE COLUMNS. 55 (uic, name_fold) pairs carry both a partner
-- and a sole_owner row in the same current vintage, so a two-column join
-- fans out. The view exposes name_fold rather than name, so consumers must
-- join INSIDE their dedup CTE, where name_fold is still in scope.
--
-- ⚠️ Written so a `WHERE uic = …` reaches idx_tr_person_roles_uic. Every
-- window here partitions by uic and the CTE is referenced ONCE, which is what
-- lets the planner push the qual below both. The first draft found the vintage
-- with a self-join onto a second reference of the same CTE; that materialises
-- it, and the per-eik lookup on the corpus's largest company (204332614, 1,117
-- role rows) cost 26,208 buffers / 252 ms. As written it is 28 buffers /
-- 2.4 ms. Re-EXPLAIN that company before adding a second reference.
--
-- ⚠️ The COLUMN LIST is one-way. load_tr_pg.ts applies this file on every run
-- and CREATE OR REPLACE VIEW can only APPEND a column — never rename, drop or
-- retype one — so an edit to `share_pct` fails on every warm database in the
-- apply phase, the same 2BP01-class abort this file's header is built around.
-- The escape is a hand-written DROP+CREATE, and once 008/022 read this view
-- that DROP needs CASCADE, which is the silent deletion the header forbids.
-- Append, or write the migration deliberately.
CREATE OR REPLACE VIEW tr_owner_share AS
WITH owner_rows AS (
  SELECT r.uic, r.name_fold, r.role, r.added_at,
         tr_share_eur(r.share_amount, r.share_currency) AS eur,
         max(r.added_at) OVER (PARTITION BY r.uic) AS latest_at
  FROM tr_person_roles r
  WHERE r.role IN ('partner', 'sole_owner') AND r.erased_at IS NULL
),
-- One person can hold several share records in a single filing; they own the
-- sum. Aggregating here is also what keeps the view unique on its key.
--
-- `latest_at IS NULL` = the company files no dates at all, so every row is in.
-- The mirror case is the trap: max() ignores NULLs, so in a company holding
-- SOME dated and some undated active owner rows the undated ones fail
-- `added_at = latest_at` (NULL → false) and would leave the numerator AND the
-- denominator entirely — inflating the survivors against a short denominator,
-- the very thing the missing-amount rule refuses, and invisible to a
-- sums-to-100 gate because the survivors still sum to 100. They are kept and
-- counted as missing instead, which refuses the company. 0 rows are in that
-- state today; this is a guard, not a fix.
cur AS (
  SELECT uic, name_fold, role,
         sum(eur) AS eur,
         bool_or(eur IS NULL)
           OR bool_or(added_at IS NULL AND latest_at IS NOT NULL) AS missing
  FROM owner_rows
  WHERE latest_at IS NULL OR added_at = latest_at OR added_at IS NULL
  GROUP BY uic, name_fold, role
)
SELECT uic, name_fold, role,
       CASE
         WHEN role = 'sole_owner'
              AND count(*) OVER (PARTITION BY uic) = 1 THEN 100::numeric
         WHEN bool_or(missing) OVER (PARTITION BY uic)
              OR sum(eur) OVER (PARTITION BY uic) IS NULL
              OR sum(eur) OVER (PARTITION BY uic) <= 0 THEN NULL
         ELSE round(100 * eur / sum(eur) OVER (PARTITION BY uic), 4)
       END AS share_pct
FROM cur;
