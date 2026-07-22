-- Drop the vestigial `current_amount_eur` column.
--
-- This column is dead weight: it was never in COLUMN_NAMES (so the loader never
-- populates it), never in 001 or any ADD COLUMN migration, and it is projected/read
-- by NOTHING — no SQL function, no DbDataTable registry, no functions/, no src/ or
-- ai/ code. The post-annex "current value" lives in `amount_eur` (flipped in place by
-- scripts/procurement/anexi_current_value.ts; `signing_amount_eur` preserves the
-- at-signing value — see 078). The only survivors were two clarifying comments.
--
-- It existed only on a long-lived LOCAL database (manually populated under an earlier
-- model, ~2% of rows); Cloud SQL never had it. `DROP COLUMN IF EXISTS` makes local
-- match cloud and is a harmless no-op everywhere the column is already absent —
-- idempotent, so it stays in the loader's apply list.
-- contracts_list is `SELECT c.*`, so it pins every column — drop the serving view,
-- drop the column, then rebuild the view over the new column set (the same helper
-- 042/050/087 use). On cloud the column is already absent, so the DROP COLUMN is a
-- no-op and this is just a harmless view rebuild.
DROP VIEW IF EXISTS contracts_list;
ALTER TABLE contracts DROP COLUMN IF EXISTS current_amount_eur;
SELECT rebuild_contracts_list();
