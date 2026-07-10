-- contracts.unp — the УНП (АОП unique procurement number, "00353-2019-0127").
--
-- Why. `contracts.ocid` is NOT a usable join key to `tenders`. The three feeds
-- we ingest write three disjoint ocid namespaces:
--
--   legacy CSV (2016-2023)   aop-legacy-<dataset>-<documentId>
--   ЦАИС ЕОП flat (2024-25)  eop-<УНП>              (or eop-<contractNumber>)
--   АОП OCDS (2026)          ocds-e82gsb-<tenderId>
--
-- while `tenders.ocid` is always `ocds-e82gsb-*`. Joining contracts→tenders on
-- ocid therefore matches 2026 only and silently returns zero rows for every
-- earlier year. The УНП is stable across all three feeds and is what actually
-- identifies a procurement procedure.
--
-- Population, per feed (see scripts/procurement/backfill_unp.ts):
--   legacy  — published as a CSV column ("УНП" / "Уникален номер на поръчката")
--   eop     — embedded in the ocid; `substring(ocid from 5)`
--   ocds    — NOT published in the release; resolved from `tenders` on the
--             shared ocid by resolve_contract_unp() below
--
-- Coverage is bounded by the `tenders` corpus, which starts at procedure-year
-- 2020 (and is thin for 2020 itself — ЦАИС ЕОП rolled out mid-year). Contracts
-- referencing a pre-2020 procedure carry a УНП that no tender row matches; that
-- is a source limit, not a defect. Callers must treat a missing tender join as
-- "unknown", never as "no overrun".

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS unp text;

-- Partial: ~24% of rows have no УНП (pre-2016 legacy, ЕОП rows published without
-- one), and every consumer joins on a non-null unp.
CREATE INDEX IF NOT EXISTS idx_contracts_unp ON contracts(unp) WHERE unp IS NOT NULL;

-- `tenders.unp` is already the table's PRIMARY KEY — no index needed there.

-- Fill the OCDS rows' УНП from the tender that shares their ocid. Idempotent and
-- cheap (only touches unp IS NULL rows), so both loaders call it: load_pg.ts
-- after the contracts COPY, and load_tenders_pg.ts after the tenders COPY —
-- whichever runs second is the one that actually resolves them, and neither
-- ordering leaves the column stale.
CREATE OR REPLACE FUNCTION resolve_contract_unp() RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.tenders') IS NULL THEN
    RETURN 0;
  END IF;
  UPDATE contracts c
     SET unp = t.unp
    FROM tenders t
   WHERE c.unp IS NULL
     AND c.ocid LIKE 'ocds-%'
     AND t.ocid = c.ocid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
