-- Canonical ЦАИС procurement reference — a single join key that mirrors the
-- `unp` field the СИГМА (sigma.midt.bg) build (and ЦАИС ЕОП itself) exposes, so
-- our corpus can be reconciled row-for-row against that external re-aggregation.
--
-- WHY a new column and NOT `unp`. `contracts.unp` is deliberately reserved for
-- the standard АОП УНП ("00044-2024-0047") because its job is to join
-- `tenders.unp` — see scripts/procurement/normalize_eop.ts:210-216, which
-- explicitly refuses to let a ЦАИС-internal `T…` id reach `Contract.unp`. But
-- in-house / negotiated / framework-call-off awards have NO standard УНП: ЦАИС
-- (and СИГМА) key them by the internal tender id instead, e.g. `T78923`. Those
-- rows carry the id only in `ocid` (`eop-T78923`, or the bare numeric in
-- `ocds-e82gsb-566491`), so they were invisible to any УНП join — ~€4.4bn of
-- 2020+ value (parity audit docs/procurement-sigma-parity-audit-2026-07-16-v2.md
-- §7.1). СИГМА prefixes the numeric ЦАИС id with `T` (our `ocds-e82gsb-566491`
-- ⇒ its `unp="T566491"`); the eop feed already carries the `T`.
--
-- `cais_id` = the standard УНП when we have one, else the recovered `T…` id.
-- That equals СИГМА's `unp` field exactly, so `sigma.unp = contracts.cais_id`
-- joins the whole corpus. Purely DERIVED (a STORED generated column, like
-- `title_fold`): it changes NO totals, needs no shard/Contract-type change, and
-- is recomputed automatically on every reload (contracts_stage is created
-- `LIKE contracts INCLUDING GENERATED`). NULL only for the pre-ЦАИС
-- `aop-legacy-*` tail, whose ocid holds a legacy АОП doc-id, not a ЦАИС id.
--
-- ALTER-based (001's CREATE TABLE IF NOT EXISTS is a no-op on an existing DB).

ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS cais_id text
  GENERATED ALWAYS AS (
    CASE
      WHEN unp IS NOT NULL AND unp <> '' THEN unp
      WHEN ocid LIKE 'eop-T%'        THEN substring(ocid FROM 5)         -- 'eop-T78923'        -> 'T78923'
      WHEN ocid LIKE 'ocds-e82gsb-%' THEN 'T' || substring(ocid FROM 13) -- 'ocds-e82gsb-566491'-> 'T566491'
      ELSE NULL
    END
  ) STORED;

-- Join/lookup key for external reconciliation (sigma.unp = contracts.cais_id).
CREATE INDEX IF NOT EXISTS idx_contracts_cais_id ON contracts(cais_id);
