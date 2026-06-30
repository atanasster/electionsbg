-- Procurement source-of-truth schema (Phase 2a).
-- One row per (contract, supplier) tuple — the flat Contract record defined in
-- scripts/procurement/types.ts. Money is stored at FULL precision (REAL =
-- IEEE-754 double, bit-identical round-trip with JS numbers); cents rounding
-- stays in the serializer (validate.ts:canonicalJson), never in SQL, so the
-- generated JSON keeps a single rounding authority.
--
-- Contractors / awarders are GROUP BY queries over this table, not stored
-- tables (materialize later only if generation perf needs it).
--
-- See docs/plans/sql-migration-v1.md.

CREATE TABLE IF NOT EXISTS contracts (
  -- Identity. `key` is the disambiguated URL slug (globally unique — see
  -- contract_key.ts:disambiguateContractKeys); it is the SPA row identity.
  key                          TEXT PRIMARY KEY,
  ocid                         TEXT NOT NULL,
  release_id                   TEXT NOT NULL,
  contract_id                  TEXT,
  tag                          TEXT NOT NULL,  -- award | contract | contractAmendment

  -- When.
  date                         TEXT NOT NULL,  -- ISO YYYY-MM-DD
  date_signed                  TEXT,

  -- Awarding side (buyer).
  awarder_eik                  TEXT NOT NULL,  -- may be "" for a few legacy rows
  awarder_name                 TEXT NOT NULL,
  awarder_region               TEXT,
  awarder_locality             TEXT,
  awarder_postal               TEXT,
  awarder_street               TEXT,

  -- Contractor side (supplier).
  contractor_eik               TEXT NOT NULL,  -- may be "" for a few legacy rows
  contractor_eik_full          TEXT,
  contractor_name              TEXT NOT NULL,

  -- Money. Native amount + currency preserved as-is; amount_eur is the
  -- euro-converted value (BGN via the locked 1.95583 peg), NULL for the rare
  -- USD/GBP/CHF rows kept native.
  amount                       REAL,
  currency                     TEXT,
  amount_eur                   REAL,

  -- Subject.
  title                        TEXT NOT NULL,
  cpv                          TEXT,
  procurement_method           TEXT,
  category                     TEXT,
  procurement_method_rationale TEXT,
  number_of_tenderers          INTEGER,
  eu_funded                    INTEGER,        -- 0/1 (boolean), NULL = unknown
  eu_program                   TEXT,
  tender_period_start_date     TEXT,
  tender_period_end_date       TEXT,

  -- Source / provenance.
  bundle_uuid                  TEXT NOT NULL,
  source_url                   TEXT NOT NULL
);

-- Indexes for the generators (per-entity rollups + lists) and the stable
-- month-shard ordering (date, ocid, key).
CREATE INDEX IF NOT EXISTS idx_contracts_contractor ON contracts(contractor_eik);
CREATE INDEX IF NOT EXISTS idx_contracts_awarder    ON contracts(awarder_eik);
CREATE INDEX IF NOT EXISTS idx_contracts_order      ON contracts(date, ocid, key);
CREATE INDEX IF NOT EXISTS idx_contracts_tag        ON contracts(tag);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
