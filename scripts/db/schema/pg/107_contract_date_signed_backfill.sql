-- Backfill: guarantee contracts.date_signed is always populated.
--
-- The contracts table (/company/:eik/contracts, /awarder/:eik/contracts) renders
-- date_signed as its single canonical date, so a null/empty value would show a
-- blank date. Normalisation now falls date_signed back to `date` at ingest
-- (scripts/procurement/normalize*.ts), and the loader applies the same invariant
-- after every merge (scripts/db/load_pg.ts). This standalone, idempotent migration
-- covers the cloud path where the contracts table is NOT fully reloaded — apply it
-- surgically:
--
--   npx tsx scripts/db/apply_functions.ts 107_contract_date_signed_backfill.sql   (local)
--   (cloud: the db:*:cloud apply flow)
--
-- `date` is unchanged, so no date-indexed aggregate, matview, or scope window is
-- affected — only the previously-null date_signed values are filled.

UPDATE contracts
SET date_signed = date
WHERE date_signed IS NULL OR date_signed = '';
