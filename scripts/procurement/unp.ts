// The УНП (АОП unique procurement number), e.g. "00353-2019-0127".
//
// This is the join key between `contracts` and `tenders` — see
// scripts/db/schema/pg/049_contracts_unp.sql. The three feeds we ingest write
// three disjoint `ocid` namespaces, so `ocid` cannot serve.
//
// Validation is not pedantry. Two sources put non-УНП values in the УНП slot:
// the ЦАИС ЕОП flat feed publishes a `T…` internal id (e.g. "T56644") in
// `uniqueProcurementNumber` for some procedures, and several legacy CSV years
// leave the column blank or carry a bare numeric procedure id. A malformed value
// stored as `unp` joins to nothing while reading downstream as "we have lineage",
// which is worse than a null.
export const UNP_RE = /^\d{5}-\d{4}-\d{4}$/;

/** True when `s` is a well-formed УНП and therefore safe to store as `Contract.unp`. */
export const isUnp = (s: string | undefined | null): s is string =>
  !!s && UNP_RE.test(s);

/**
 * Header-name patterns for the УНП column in the legacy АОП CSVs. Single source
 * of truth: both the ingest parser (legacy_csv.ts `COLUMN_PATTERNS.unp`) and the
 * one-off shard backfill (backfill_unp.ts) consume this, so a header rename can't
 * make the two disagree — a drift would silently drop rows to `unp = null`.
 *
 * NOTE: must stay declared BEFORE any bare-numeric "ID на поръчката" pattern
 * where header matching is order-sensitive — see legacy_csv.ts for why.
 */
export const UNP_HEADER_PATTERNS: readonly RegExp[] = [
  /^унп$/i,
  /уникален.*номер.*на.*поръчк/i,
  /уникален.*номер.*поръчка/i,
];
