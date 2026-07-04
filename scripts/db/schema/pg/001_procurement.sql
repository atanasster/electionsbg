-- Procurement schema — PostgreSQL port of scripts/db/schema/001_procurement.sql.
-- Same column set/names as the SQLite version so the shared row⇄Contract map
-- (lib/procurement_schema.ts) and the source-agnostic builders port unchanged.
-- Types: TEXT→text, REAL→double precision, INTEGER→integer; eu_funded stays
-- integer (0/1), NOT boolean, so rowToContract's 0/1→bool mapping is identical.
--
-- Extensions for the (upcoming) name search: pg_trgm (fuzzy/partial via GIN),
-- unaccent (diacritic fold). See docs/plans/postgres-migration-v1.md.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS contracts (
  key                          text PRIMARY KEY,
  ocid                         text NOT NULL,
  release_id                   text NOT NULL,
  contract_id                  text,
  tag                          text NOT NULL,
  date                         text NOT NULL,
  date_signed                  text,
  awarder_eik                  text NOT NULL,
  awarder_name                 text NOT NULL,
  awarder_region               text,
  awarder_locality             text,
  awarder_postal               text,
  awarder_street               text,
  contractor_eik               text NOT NULL,
  contractor_eik_full          text,
  contractor_name              text NOT NULL,
  amount                       double precision,
  currency                     text,
  amount_eur                   double precision,
  title                        text NOT NULL,
  cpv                          text,
  procurement_method           text,
  category                     text,
  procurement_method_rationale text,
  number_of_tenderers          integer,
  eu_funded                    integer,
  eu_program                   text,
  tender_period_start_date     text,
  tender_period_end_date       text,
  bundle_uuid                  text NOT NULL,
  source_url                   text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contracts_contractor ON contracts(contractor_eik);
CREATE INDEX IF NOT EXISTS idx_contracts_awarder    ON contracts(awarder_eik);
CREATE INDEX IF NOT EXISTS idx_contracts_order      ON contracts(date, ocid, key);
CREATE INDEX IF NOT EXISTS idx_contracts_tag        ON contracts(tag);
-- (eik, date) composites for the DATE-SCOPED entity rollups: awarder_procurement
-- / company_procurement filter `WHERE {awarder,contractor}_eik = $1 AND date
-- BETWEEN $2 AND $3` (the awarder/company page scope pill — this parliament / a
-- year). Without these, adding a date window makes the planner BitmapAnd the
-- single-col eik index against idx_contracts_order (a 39k-row date-range bitmap,
-- ~320 disk pages cold) instead of one tight range seek — the windowed query is
-- SLOWER than all-time (24-72ms cold vs 6ms) despite touching fewer rows. The
-- composite collapses it to a 4-buffer index scan over just the eik's rows.
CREATE INDEX IF NOT EXISTS idx_contracts_awarder_date
  ON contracts(awarder_eik, date);
CREATE INDEX IF NOT EXISTS idx_contracts_contractor_date
  ON contracts(contractor_eik, date);
-- Covering index for per-contractor count + sum(amount_eur) FILTER (tag): the
-- company-page summary and the person page's per-company value bars (person_roles)
-- both aggregate contracts by contractor_eik. INCLUDE (amount_eur) + tag in the
-- key make the sum an Index Only Scan (no heap) — person_roles on a big
-- contractor 117ms→3.4ms, 8385→244 buffers.
CREATE INDEX IF NOT EXISTS idx_contracts_contractor_tag_amt
  ON contracts(contractor_eik, tag) INCLUDE (amount_eur);
-- ocid is the tender→award lineage key (tenders.ocid = contracts.ocid). The
-- (date,ocid,key) composite can't seek by ocid alone (leading col is date), so
-- the tenders LATERAL joins (tenders_by_buyer / tender_awards) need this or they
-- seq-scan contracts per tender (14s for a big buyer's pipeline).
CREATE INDEX IF NOT EXISTS idx_contracts_ocid       ON contracts(ocid);
-- The global contracts browser (/procurement/contracts → /api/db/table) always
-- filters by tag and default-sorts date DESC with a `key` tiebreaker; without
-- this the all-years page is a 300k-row parallel seq scan + top-N sort per page
-- (142ms local, worse on Cloud SQL). Same for the amount_eur sort option.
-- NULLS LAST matches the table engine's "DESC NULLS LAST" order exactly —
-- without it the planner can't early-terminate and walks the whole tag.
CREATE INDEX IF NOT EXISTS idx_contracts_tag_date
  ON contracts(tag, date DESC NULLS LAST, key);
CREATE INDEX IF NOT EXISTS idx_contracts_tag_amount
  ON contracts(tag, amount_eur DESC NULLS LAST);
-- Global text search in the browser is `col ILIKE '%q%'` over the three text
-- columns — trigram GIN makes each a bitmap scan instead of a seq scan (298ms
-- full-corpus local without them).
CREATE INDEX IF NOT EXISTS idx_contracts_awarder_name_trgm
  ON contracts USING gin (awarder_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_contractor_name_trgm
  ON contracts USING gin (contractor_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contracts_title_trgm
  ON contracts USING gin (title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS meta (
  key   text PRIMARY KEY,
  value text
);
