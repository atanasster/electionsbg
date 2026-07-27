-- Judiciary precomputed page-payload blobs, served verbatim by /api/db so no
-- route downloads a static JSON from the bucket (persons-pg-retirement-v1 T2.6).
--
-- First tenant: kind='declarations', key='' — the ИВСС magistrate-declaration
-- register index (data/judiciary/declarations.json, built by the live scrape in
-- scripts/judiciary/__write_declarations.ts). That artifact is a self-contained
-- scrape (register letter-pages + the ИВСС integrity lists, which name late/
-- discrepancy magistrates) and its yearly counts do NOT come from the normalised
-- `declaration` table — so it is stored whole rather than re-derived, exactly like
-- fund_payloads (043) / agri_payloads (046). The JSON stays on disk as the loader's
-- SOURCE and is dropped from the bucket sync; PG becomes the only serving path.
--
-- (kind, key) mirrors fund_payloads so future per-magistrate blobs can key by name.

CREATE TABLE IF NOT EXISTS judiciary_payloads (
  kind    text  NOT NULL,
  key     text  NOT NULL DEFAULT '',
  payload jsonb NOT NULL,
  PRIMARY KEY (kind, key)
);
