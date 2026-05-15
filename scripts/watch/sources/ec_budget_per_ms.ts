// European Commission "EU spending and revenue" per-Member-State spreadsheet.
// Source of truth for the euFunds / euContribution series in data/macro.json
// — see scripts/macro/fetch_eurostat.ts (EU_FUNDS / EU_CONTRIBUTION).
//
// The EC publishes a single XLSX containing one sheet per calendar year from
// 2000 onwards, with the BG column carrying total EU expenditure in Bulgaria
// and Bulgaria's national contribution. A new sheet appears ~yearly (typically
// the July following the reference year, after Member-State own-resources
// reconciliation closes); the filename embeds the year range
// (`...2000-<latest_year>.xlsx`) and the document UUID changes with each
// reissue.
//
// We fingerprint the parent listing page's XLSX link rather than HEADing the
// 1MB binary directly — both the UUID and the embedded year range flip when
// the EC publishes an updated edition, so the link string is sufficient and
// keeps the watcher cheap.
//
// When this fires, /update-macro re-reads BG-column totals out of the XLSX
// and patches the EU_FUNDS / EU_CONTRIBUTION arrays in
// scripts/macro/fetch_eurostat.ts.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const PAGE =
  "https://commission.europa.eu/strategy-and-policy/eu-budget/long-term-eu-budget/2021-2027/spending-and-revenue_en";

// Captures the year range embedded in the filename, e.g.
// "eu_budget_spending_and_revenue_2000-2023.xlsx" → "2000-2023".
const XLSX_LINK_RE =
  /href="([^"]*eu_budget_spending_and_revenue[_-](\d{4}-\d{4})\.xlsx[^"]*)"/i;

interface XlsxLinkMeta {
  href: string;
  yearRange: string;
}

const extractXlsxLink = (html: string): XlsxLinkMeta => {
  const m = XLSX_LINK_RE.exec(html);
  if (!m) {
    throw new Error(
      "EC budget per-MS XLSX link not found on listing page — page layout may have changed",
    );
  }
  return { href: m[1], yearRange: m[2] };
};

export const ecBudgetPerMs: WatchSource = {
  id: "ec_budget_per_ms",
  label: "EC EU budget per-MS spreadsheet (BG receipts/contributions)",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html) throw new Error("empty EC spending-and-revenue listing");
    const { href, yearRange } = extractXlsxLink(html);
    const value = sha256Short(`${yearRange}|${href}`);
    return {
      value,
      detail: `BG receipts/contributions XLSX · years ${yearRange}`,
      meta: { href, yearRange },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevYears = (prev.meta?.yearRange as string | undefined) ?? "?";
    const currYears = (curr.meta?.yearRange as string | undefined) ?? "?";
    if (prevYears !== currYears) {
      return `new EC edition · year range ${prevYears} → ${currYears}`;
    }
    return `XLSX URL changed · year range still ${currYears} (re-pull and diff BG totals)`;
  },
};
