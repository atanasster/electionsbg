-- Tenders (procedures) schema — the tender-STAGE counterpart to contracts
-- (001_procurement.sql). A tender is the PROCEDURE, before any contract exists:
-- it carries an ESTIMATED (прогнозна) value — a forecast, NOT money spent — no
-- contractor, and a different lifecycle (active → cancelled / contracted).
--
-- QUARANTINE: estimated_value_native / estimated_value_eur are FORECASTS and are
-- NEVER summed into any contracted-spend aggregate. Keeping tenders in their own
-- table (not contracts) is exactly what keeps that quarantine honest. See
-- docs/plans/procurement-tenders-ingest-v1.md §12 and
-- scripts/procurement/normalize_eop_tender.ts.
--
-- Lineage: tender_id = the OCDS ocid suffix, so `tenders.ocid = contracts.ocid`
-- joins a procedure to the signed contract that came out of it — the free link
-- that completes the procurement lifecycle (procedure → award) in one engine.
--
-- Column ORDER mirrors the Tender object's field insertion order in
-- normalize_eop_tender.ts (buildTenders), so the source-agnostic generator can
-- reproduce the by-ocid / by-tender shards byte-for-byte (canonicalJson is
-- order-preserving). translit_bg_latin (000_search_fns.sql) powers the folds.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS tenders (
  unp                    text PRIMARY KEY,
  ocid                   text,
  -- integer (int4) not bigint: max observed ids are ~600k / ~870k (well under
  -- the 2.1B ceiling), and int4 comes back from node-pg as a JS number, so the
  -- generator reproduces `"tenderId": 448564` (not the quoted int8 string).
  tender_id              integer,
  notice_id              integer,
  publication_date       text NOT NULL,
  buyer_eik              text NOT NULL,
  buyer_name             text NOT NULL,
  buyer_type             text,
  buyer_main_activity    text,
  subject                text NOT NULL,
  notice_type            text,
  procedure_type         text,
  award_method           text,
  legal_basis            text,
  contract_type          text,
  cpv                    text,
  cpv_desc               text,
  estimated_value_native double precision, -- FORECAST — never summed into spend
  currency               text,
  estimated_value_eur    double precision, -- FORECAST — never summed into spend
  lots_count             integer,
  lots                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  submission_deadline    text,
  is_cancelled           boolean NOT NULL,
  is_framework_agreement boolean,
  is_eu_funded           boolean,
  eu_program             text,
  has_unsecured_funding  boolean,
  nuts                   text,
  link_to_oj_eu          text,
  change_notice_count    integer,
  source_day             text NOT NULL,
  source_url             text NOT NULL,
  -- Search folds (Streamlined-System romanization, collation-independent).
  buyer_fold             text GENERATED ALWAYS AS (translit_bg_latin(buyer_name)) STORED,
  subject_fold           text GENERATED ALWAYS AS (translit_bg_latin(subject)) STORED
);

-- Run-stamp table (shared with contracts; created there too — IF NOT EXISTS so
-- loading tenders into a fresh DB is self-contained).
CREATE TABLE IF NOT EXISTS meta (
  key   text PRIMARY KEY,
  value text
);

-- Lineage join to the signed contract (tenders.ocid = contracts.ocid).
CREATE INDEX IF NOT EXISTS idx_tenders_ocid       ON tenders(ocid);
CREATE INDEX IF NOT EXISTS idx_tenders_buyer      ON tenders(buyer_eik);
CREATE INDEX IF NOT EXISTS idx_tenders_order      ON tenders(publication_date, unp);
CREATE INDEX IF NOT EXISTS idx_tenders_cancelled  ON tenders(is_cancelled);
CREATE INDEX IF NOT EXISTS idx_tenders_buyer_fold ON tenders USING gin (buyer_fold gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tenders_subj_fold  ON tenders USING gin (subject_fold gin_trgm_ops);
