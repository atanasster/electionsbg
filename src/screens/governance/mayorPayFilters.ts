// The pure filter/sort transform behind GovernanceMayorPayScreen's table —
// extracted so the two bugs found reviewing the inline version (an inverted
// name-column direction, and null "not on file" rows sorting as if they were
// the smallest real value) have a home a test can reach directly, the same
// way municipalFinanceFilters.ts's applyFilters does for its sibling screen.

import type { MayorPayRankingRow } from "@/data/officials/useMayorPayRanking";
import { searchMatches } from "@/lib/translitSearch";

export type MayorPaySortKey = "perThousand" | "income" | "population" | "name";

/** Sort key for one column. Numeric columns return `null` for "not on
 *  file" — the comparator below sorts that LAST in both directions, the same
 *  rule municipalFinanceFilters.ts applies to a withheld figure. Returning a
 *  sentinel number instead (e.g. -1) is the trap it replaced: it made "no
 *  data" look like the smallest real value the moment a reader sorted
 *  ascending. */
const sortKey = (
  r: MayorPayRankingRow,
  sort: MayorPaySortKey,
): number | string | null => {
  if (sort === "perThousand") return r.income_per_1000_residents_eur;
  if (sort === "income") return r.income_eur;
  if (sort === "population") return r.population;
  return r.name_bg;
};

/** The fresh-click direction for a column, matching what its header's arrow
 *  is expected to show first: name A→Z, every numeric column high→low. */
export const defaultAscFor = (sort: MayorPaySortKey): boolean =>
  sort === "name";

/**
 * Match a natural person/place query against one mayor-pay row.
 *
 * Bulgarian names usually carry a patronymic, so a reader's first + family
 * query ("Васил Терзиев") is not a contiguous substring of the stored full
 * name ("Васил Александров Терзиев"). Split the query and require every term
 * to occur somewhere in this same row. `searchMatches` also keeps the shared
 * Cyrillic/Latin and shliokavitsa tolerance used by the registry browsers.
 */
export const mayorPaySearchMatches = (
  row: MayorPayRankingRow,
  query: string,
): boolean => {
  const terms = query
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    row.name_bg,
    row.name_en ?? "",
    row.mayor_name,
  ].join(" ");
  return terms.every((term) => searchMatches(haystack, term));
};

export const applyMayorPayFilter = (
  rows: MayorPayRankingRow[],
  q: string,
  sort: MayorPaySortKey,
  asc: boolean,
): MayorPayRankingRow[] => {
  const filtered = q.trim()
    ? rows.filter((r) => mayorPaySearchMatches(r, q))
    : rows;
  return [...filtered].sort((a, b) => {
    const ka = sortKey(a, sort);
    const kb = sortKey(b, sort);
    // The name column is always a string (name_bg is never null) — this
    // branch never sees a null operand.
    if (typeof ka === "string" || typeof kb === "string") {
      const cmp = String(ka ?? "").localeCompare(String(kb ?? ""), "bg");
      return asc ? cmp : -cmp;
    }
    // Numeric columns: "not on file" sorts LAST regardless of direction —
    // never as if it were the smallest value.
    if (ka == null && kb == null) return 0;
    if (ka == null) return 1;
    if (kb == null) return -1;
    return asc ? ka - kb : kb - ka;
  });
};
