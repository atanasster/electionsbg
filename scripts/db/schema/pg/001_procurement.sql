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
-- ocid is the tender→award lineage key (tenders.ocid = contracts.ocid). The
-- (date,ocid,key) composite can't seek by ocid alone (leading col is date), so
-- the tenders LATERAL joins (tenders_by_buyer / tender_awards) need this or they
-- seq-scan contracts per tender (14s for a big buyer's pipeline).
CREATE INDEX IF NOT EXISTS idx_contracts_ocid       ON contracts(ocid);

CREATE TABLE IF NOT EXISTS meta (
  key   text PRIMARY KEY,
  value text
);
