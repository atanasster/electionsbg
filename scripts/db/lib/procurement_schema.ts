// Single source of truth for the contracts column ⇄ Contract field mapping.
// Both the loader and the round-trip verifier import this, so the SQL store and
// the JSON reconstruction can never drift apart. If a new Contract field is
// added in scripts/procurement/types.ts, add it here and to 001_procurement.sql;
// the round-trip test fails loudly until the corpus is captured losslessly.
//
// See docs/plans/sql-migration-v1.md (Phase 2).

import type { Contract } from "../../procurement/types";

type Kind = "text" | "real" | "int" | "bool";

interface ColumnDef {
  field: keyof Contract;
  col: string;
  kind: Kind;
}

// Order here defines the INSERT column order. (It does NOT define JSON field
// order — month-shard rows carry 113 source-dependent orderings, so byte-exact
// shard regeneration isn't a goal; lossless capture, compared order-independent,
// is.)
export const COLUMNS: ColumnDef[] = [
  { field: "key", col: "key", kind: "text" },
  { field: "ocid", col: "ocid", kind: "text" },
  { field: "releaseId", col: "release_id", kind: "text" },
  { field: "contractId", col: "contract_id", kind: "text" },
  { field: "unp", col: "unp", kind: "text" },
  { field: "tag", col: "tag", kind: "text" },
  { field: "date", col: "date", kind: "text" },
  { field: "dateSigned", col: "date_signed", kind: "text" },
  { field: "awarderEik", col: "awarder_eik", kind: "text" },
  { field: "awarderName", col: "awarder_name", kind: "text" },
  { field: "awarderRegion", col: "awarder_region", kind: "text" },
  { field: "awarderLocality", col: "awarder_locality", kind: "text" },
  { field: "awarderPostal", col: "awarder_postal", kind: "text" },
  { field: "awarderStreet", col: "awarder_street", kind: "text" },
  { field: "contractorEik", col: "contractor_eik", kind: "text" },
  { field: "contractorEikFull", col: "contractor_eik_full", kind: "text" },
  { field: "contractorName", col: "contractor_name", kind: "text" },
  { field: "amount", col: "amount", kind: "real" },
  { field: "currency", col: "currency", kind: "text" },
  { field: "amountEur", col: "amount_eur", kind: "real" },
  { field: "title", col: "title", kind: "text" },
  { field: "cpv", col: "cpv", kind: "text" },
  { field: "procurementMethod", col: "procurement_method", kind: "text" },
  { field: "category", col: "category", kind: "text" },
  {
    field: "procurementMethodRationale",
    col: "procurement_method_rationale",
    kind: "text",
  },
  { field: "numberOfTenderers", col: "number_of_tenderers", kind: "int" },
  { field: "euFunded", col: "eu_funded", kind: "bool" },
  { field: "euProgram", col: "eu_program", kind: "text" },
  {
    field: "tenderPeriodStartDate",
    col: "tender_period_start_date",
    kind: "text",
  },
  { field: "tenderPeriodEndDate", col: "tender_period_end_date", kind: "text" },
  { field: "bundleUuid", col: "bundle_uuid", kind: "text" },
  { field: "sourceUrl", col: "source_url", kind: "text" },
];

export const COLUMN_NAMES = COLUMNS.map((c) => c.col);
export const INSERT_SQL = `INSERT INTO contracts (${COLUMN_NAMES.join(", ")}) VALUES (${COLUMN_NAMES.map(() => "?").join(", ")})`;

// Non-blocking contracts reload (see reference_contracts_reload_lock): rather
// than TRUNCATE + COPY (AccessExclusive on contracts for the whole multi-minute
// COPY, which 500'd /procurement), the loader COPYs the fresh corpus into an
// unlogged `contracts_stage` and MERGEs it into the live table. Both the upsert
// and the delete take only RowExclusiveLock, so concurrent reads never block.
// `key` is the primary key; `title_fold` is a generated column (regenerated from
// `title` on insert) so it is neither COPY'd nor compared. Derived from
// COLUMN_NAMES so it can't drift from the column set.
const NON_KEY_COLUMNS = COLUMN_NAMES.filter((c) => c !== "key");

// Insert new keys + update only genuinely-changed rows (the row-value IS
// DISTINCT FROM guard skips unchanged rows, so a re-load of a mostly-identical
// corpus writes almost nothing — no dead-tuple churn on 300k rows every run).
export const CONTRACTS_MERGE_UPSERT_SQL = `INSERT INTO contracts (${COLUMN_NAMES.join(
  ", ",
)})
SELECT ${COLUMN_NAMES.join(", ")} FROM contracts_stage
ON CONFLICT (key) DO UPDATE SET ${NON_KEY_COLUMNS.map(
  (c) => `${c} = excluded.${c}`,
).join(", ")}
WHERE (${NON_KEY_COLUMNS.map((c) => `contracts.${c}`).join(", ")})
  IS DISTINCT FROM (${NON_KEY_COLUMNS.map((c) => `excluded.${c}`).join(", ")})`;

// Drop keys no longer present in the fresh corpus.
export const CONTRACTS_MERGE_DELETE_SQL = `DELETE FROM contracts c
WHERE NOT EXISTS (SELECT 1 FROM contracts_stage s WHERE s.key = c.key)`;

type Param = string | number | null;

/** Contract → positional INSERT params (absent fields → NULL, booleans → 0/1). */
export const contractToRow = (c: Contract): Param[] =>
  COLUMNS.map(({ field, kind }) => {
    const v = c[field];
    if (v === undefined || v === null) return null;
    if (kind === "bool") return v ? 1 : 0;
    return v as Param;
  });

type SqlRow = Record<string, string | number | null>;

/** SQL row → Contract (NULL columns omitted so the object matches the source
 *  shape; 0/1 → boolean). Compared against the on-disk row with deepStrictEqual,
 *  which is key-order-independent. */
export const rowToContract = (row: SqlRow): Contract => {
  const out: Record<string, unknown> = {};
  for (const { field, col, kind } of COLUMNS) {
    const v = row[col];
    if (v === null || v === undefined) continue;
    out[field] = kind === "bool" ? v === 1 : v;
  }
  return out as unknown as Contract;
};
