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
-- joins the whole corpus. It changes NO totals — purely a join key.
--
-- WHY a plain column + helper fn, NOT a GENERATED column. A STORED generated
-- column can't be added without a full table REWRITE under AccessExclusive
-- (~40s local / minutes on Cloud SQL for 347k rows), which would 500 every
-- /procurement + contracts-browser read for the whole window (see
-- reference_contracts_reload_lock). A plain `ADD COLUMN` is instant (metadata
-- only) and the populating UPDATE takes RowExclusiveLock (readers never block),
-- so this deploys with ZERO downtime — same lock-free discipline as the
-- contracts MERGE. Population is done by load_pg.ts right after the MERGE (so
-- new/changed rows stay correct every reload); a standalone apply to a live DB
-- runs the same UPDATE once (see below).

-- Deterministic derivation, shared by the loader's post-merge UPDATE and any
-- standalone backfill. IMMUTABLE: same (unp, ocid) → same ref, always.
CREATE OR REPLACE FUNCTION contract_cais_ref(p_unp text, p_ocid text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_unp IS NOT NULL AND p_unp <> '' THEN p_unp
    WHEN p_ocid LIKE 'eop-T%'        THEN substring(p_ocid FROM 5)         -- 'eop-T78923'         -> 'T78923'
    WHEN p_ocid LIKE 'ocds-e82gsb-%' THEN 'T' || substring(p_ocid FROM 13) -- 'ocds-e82gsb-566491' -> 'T566491'
    ELSE NULL
  END
$$;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS cais_id text;

-- Join/lookup key for external reconciliation (sigma.unp = contracts.cais_id).
CREATE INDEX IF NOT EXISTS idx_contracts_cais_id ON contracts(cais_id);

-- Populate existing rows (idempotent; RowExclusiveLock — readers never block).
-- On a fresh build the table is empty here and this is a no-op; load_pg.ts
-- re-runs the same UPDATE after the corpus MERGE so new rows are always set.
UPDATE contracts
   SET cais_id = contract_cais_ref(unp, ocid)
 WHERE cais_id IS DISTINCT FROM contract_cais_ref(unp, ocid);
