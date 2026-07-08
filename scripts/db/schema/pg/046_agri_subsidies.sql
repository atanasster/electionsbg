-- ДФ „Земеделие" (CAP paying agency) subsidy corpus → PG, so the /subsidies
-- dashboard + the "Земеделски субсидии" tile on /company/:eik are DB-served, and
-- every recipient EIK joins the unified entity graph (agri_subsidies.eik =
-- contracts.contractor_eik = fund_beneficiaries.eik = tr_companies.uic).
--
-- Loaded directly by scripts/agri/ingest.ts (raw egov/СЕУ sheets → normalised →
-- PG; no JSON intermediary — there is no data/agri/ shard tree, the app serves
-- from PG only). All money is EUR (converted at ingest). Individuals carry no EIK
-- (name+oblast only); the detail table keeps them for the browse, but attributable
-- analytics (top recipients, concentration) are legal-entity-only and precomputed
-- in the ingest, stored verbatim below.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Per (year × beneficiary × scheme) detail row — the browse + per-EIK scope. --
CREATE TABLE IF NOT EXISTS agri_subsidies (
  id           bigserial PRIMARY KEY,
  year         integer NOT NULL,
  eik          text,               -- legal-entity id; NULL for individuals
  name         text NOT NULL,
  oblast       text,
  scheme       text,               -- Мярка (short measure code)
  scheme_desc  text,               -- Описание (full scheme name)
  dp_eur       double precision,   -- ЕФГЗ-ДП  (direct payments)
  market_eur   double precision,   -- ЕФГЗ     (market measures)
  rural_eur    double precision,   -- ЕЗФРСР-НБ (rural development)
  total_eur    double precision    -- Общо
);

-- Entity join (company/awarder pages) + the SCOPED browse (/company/:eik).
CREATE INDEX IF NOT EXISTS idx_agri_eik ON agri_subsidies (eik);
-- Scoped browse fast-path: filter eik, then sort by money with a stable tiebreak.
CREATE INDEX IF NOT EXISTS idx_agri_eik_total
  ON agri_subsidies (eik, total_eur DESC NULLS LAST, id);
-- UNSCOPED / global browse default sort (money desc) — index-only page walk.
CREATE INDEX IF NOT EXISTS idx_agri_total
  ON agri_subsidies (total_eur DESC NULLS LAST, id);
-- Facet filters (year / oblast are the browse toolbar facets). COVERING on
-- total_eur so a facet-filtered browse serves BOTH its page (WHERE col IN (…)
-- ORDER BY total_eur DESC, id → ordered index scan, no sort) AND its footer
-- aggregate (count + sum(total_eur) → index-only scan, no heap) from one index.
-- Measured: an oblast-filtered aggregate went 410ms (seq scan 2M) → ~10-23ms
-- (index-only); the unfiltered corpus sum went 374ms → ~72ms warm (parallel
-- index-only over idx_agri_year_total, which carries total_eur).
-- NB: only CREATE IF NOT EXISTS here (no DROP+CREATE) — the loader applies this
-- schema BEFORE it TRUNCATEs, so a rebuild on the still-populated table would
-- parallel-build the index and can exhaust the container's /dev/shm. On an empty
-- (fresh) table the index is created instantly and then maintained incrementally
-- as rows insert — same pattern as every other loader.
CREATE INDEX IF NOT EXISTS idx_agri_year_total
  ON agri_subsidies (year, total_eur DESC NULLS LAST, id);
CREATE INDEX IF NOT EXISTS idx_agri_oblast_total
  ON agri_subsidies (oblast, total_eur DESC NULLS LAST, id);
CREATE INDEX IF NOT EXISTS idx_agri_scheme ON agri_subsidies (scheme);
-- Free-text beneficiary search in the browse toolbar.
CREATE INDEX IF NOT EXISTS idx_agri_name_trgm
  ON agri_subsidies USING gin (name gin_trgm_ops);

-- 2. Precomputed page payloads (verbatim), keyed by (kind, key). ----------------
--    'overview' (key '')      → the national /subsidies dashboard payload
--    'recipient' (key = eik)  → per-legal-entity rollup (/farm/:eik + company tile)
-- Storing them verbatim (computed once in the ingest against the full corpus)
-- makes local↔cloud parity byte-exact and every fetch an O(1) PK seek — same
-- rationale as fund_payloads (043).
CREATE TABLE IF NOT EXISTS agri_payloads (
  kind    text  NOT NULL,
  key     text  NOT NULL DEFAULT '',
  payload jsonb NOT NULL,
  PRIMARY KEY (kind, key)
);
