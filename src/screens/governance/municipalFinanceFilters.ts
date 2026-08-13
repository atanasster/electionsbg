// URL-owned state for /governance/municipal-finance, and the pure row shaping
// behind it. Split from the screen so the rules are testable without rendering
// a 265-row table.
//
// Every value is VALIDATED on read. An unrecognised `?sort` or a `?crit=9` is
// dropped back to the default rather than passed through — the alternative is a
// table sorted by a column that does not exist, which renders in corpus order
// and looks like a ranking.

import type { MunicipalFiscalRankingRow } from "@/data/budget/useMunicipalFiscalRanking";

/** Sortable columns, and what each one MEANS as a ranking.
 *
 *  `perCapita` is the default and `commitments` is the trap: on absolute
 *  commitments Столична община is first every year by construction, which tells
 *  a reader nothing and buries the small municipalities the page exists to
 *  surface. */
export const SORTS = {
  perCapita: "commitments_per_capita_eur",
  commitmentsPct: "commitments_pct",
  commitments: "commitments_eur",
  obligations: "expense_obligations_eur",
  obligationsPct: "obligations_pct",
  arrears: "arrears_eur",
  arrearsPct: "arrears_pct",
  debt: "debt_stock_eur",
  cash: "cash_on_hand_eur",
  population: "population",
} as const;

export type SortKey = keyof typeof SORTS;
export const DEFAULT_SORT: SortKey = "perCapita";

export interface MunicipalFinanceFilters {
  sort: SortKey;
  /** Ascending only when explicitly asked: every column here is „more is more
   *  notable", so descending is the useful default. */
  asc: boolean;
  /** Free-text over the município name, folded. */
  q: string;
  /** Keep only municipalities meeting at least N чл. 130а criteria. */
  crit: number | null;
  /** Keep only municipalities in a чл. 130д recovery procedure. */
  recovery: boolean;
  /** Year-end to rank. NULL = the newest the corpus carries. */
  year: number | null;
}

export const DEFAULTS: MunicipalFinanceFilters = {
  sort: DEFAULT_SORT,
  asc: false,
  q: "",
  crit: null,
  recovery: false,
  year: null,
};

const isSortKey = (v: string | null): v is SortKey =>
  v != null && Object.prototype.hasOwnProperty.call(SORTS, v);

export const parseFilters = (
  params: URLSearchParams,
): MunicipalFinanceFilters => {
  const rawCrit = Number(params.get("crit"));
  const rawYear = Number(params.get("year"));
  const sort = params.get("sort");
  return {
    sort: isSortKey(sort) ? sort : DEFAULT_SORT,
    asc: params.get("asc") === "1",
    q: (params.get("q") ?? "").trim(),
    // 0 is not a filter — „at least 0 criteria" is every município — so it
    // falls back to no filter rather than to a predicate matching everything
    // under a chip that claims to narrow.
    crit:
      Number.isInteger(rawCrit) && rawCrit >= 1 && rawCrit <= 6
        ? rawCrit
        : null,
    recovery: params.get("recovery") === "1",
    year:
      Number.isInteger(rawYear) && rawYear >= 2000 && rawYear <= 2100
        ? rawYear
        : null,
  };
};

/** Serialise back to a query string, omitting every default so a pristine URL
 *  stays clean and a shared one carries only what the reader actually chose. */
export const toParams = (
  f: MunicipalFinanceFilters,
  base?: URLSearchParams,
): URLSearchParams => {
  const p = new URLSearchParams(base);
  const set = (k: string, v: string | null) =>
    v == null || v === "" ? p.delete(k) : p.set(k, v);
  set("sort", f.sort === DEFAULTS.sort ? null : f.sort);
  set("asc", f.asc ? "1" : null);
  set("q", f.q || null);
  set("crit", f.crit == null ? null : String(f.crit));
  set("recovery", f.recovery ? "1" : null);
  set("year", f.year == null ? null : String(f.year));
  return p;
};

/** Latin/Cyrillic-insensitive-ish name fold for the search box: case and the
 *  various dashes and spaces, which is what separates „Георги Дамяново" from a
 *  reader typing „георги дамяново". */
export const foldName = (s: string): string =>
  s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‐-―\s\-­−]+/gu, "");

export const applyFilters = (
  rows: MunicipalFiscalRankingRow[],
  f: MunicipalFinanceFilters,
): MunicipalFiscalRankingRow[] => {
  const needle = foldName(f.q);
  const col = SORTS[f.sort];
  const kept = rows.filter((r) => {
    if (needle && !foldName(`${r.name_bg} ${r.name_en ?? ""}`).includes(needle))
      return false;
    if (f.recovery && !r.in_recovery_procedure) return false;
    if (f.crit != null && (r.criteria_met?.length ?? 0) < f.crit) return false;
    return true;
  });
  return [...kept].sort((a, b) => {
    const x = a[col];
    const y = b[col];
    // A withheld figure is NOT a zero, so it sorts LAST in both directions
    // rather than pretending to be the smallest value. Ordering it as 0 would
    // put „not published" at the top of an ascending sort as though the
    // município had contracted nothing.
    if (x == null && y == null) return a.name_bg.localeCompare(b.name_bg, "bg");
    if (x == null) return 1;
    if (y == null) return -1;
    const d = f.asc ? x - y : y - x;
    // Ties broken by name so the order is stable across re-renders and across
    // two readers looking at the same URL.
    return d || a.name_bg.localeCompare(b.name_bg, "bg");
  });
};
