// Farm-subsidy financial years actually covered by the ДФЗ corpus (descending),
// used to populate the shared procurement scope control's year picker. 2024/2025
// come from the СЕУ register (scripts/agri/seu_fetch.ts); 2015–2023 from the egov
// portal (scripts/agri/source.ts — 2014/2018/2019 absent, 2020 serves 0 rows).
export const AGRI_FINANCIAL_YEARS = [
  2025, 2024, 2023, 2022, 2021, 2017, 2016, 2015,
];

// ДФ „Земеделие" — the CAP paying agency's own EIK. It administers the subsidy
// programme (it doesn't receive farm money), so its /company page gets a card
// linking to /subsidies instead of the per-recipient "money received" tile.
// Kept in sync with PAYER_EIKS in scripts/agri/ingest.ts.
export const AGRI_PAYER_EIK = "121100421";

/** Is `year` a CAP financial year the ДФЗ corpus actually covers? */
export const isAgriFinancialYear = (year: number): boolean =>
  AGRI_FINANCIAL_YEARS.includes(year);

// Map a procurement scope (ns | all | y:YYYY) to a farm-subsidy overview payload
// key. "ns" (this parliament / default) has no per-parliament subsidy slice, so
// it resolves to the latest available financial year; "all" is the all-years
// aggregate; "y:YYYY" is that financial year.
//
// `null` = "this scope has no overview payload and never will". The `?pscope`
// param is SHARED with the procurement pages, whose year picker spans every
// calendar year since SCOPE_FIRST_YEAR (2011) — so /subsidies is routinely
// entered carrying a year the CAP corpus has no row for (useScopedHref forwards
// the whole query string from the sectors hub and the procurement nav). Building
// a key for such a year asked agri_payloads for a row that does not exist; the
// caller must render an explicit "no data for this year" state instead.
export const agriScopeToKey = (scope: string): string | null => {
  if (scope === "all") return "all";
  const year = /^y:(\d{4})$/.exec(scope); // strict: " 2024" must not coerce
  if (year) return isAgriFinancialYear(Number(year[1])) ? year[1] : null;
  if (scope.startsWith("y:")) return null;
  return ""; // ns → '' → the latest financial year
};

// Map the same scope to a year value for the browse table's `year` filter, or
// null for the all-years / unfiltered case.
export const agriScopeToYear = (scope: string): number | null => {
  if (scope === "all") return null;
  if (scope.startsWith("y:")) return Number(scope.slice(2));
  return AGRI_FINANCIAL_YEARS[0]; // ns → latest year
};
