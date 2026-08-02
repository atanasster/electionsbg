// "Download CSV" for the /persons browser.
//
// It re-issues THE USER'S CURRENT QUERY at a larger pageSize rather than exporting the 25
// rows on screen or, worse, the whole unfiltered table. `onData`'s second argument is the
// exact request body that produced the visible page — scope, filters, sort, and the
// DEBOUNCED search term the table owns — so an export cannot silently drop whatever the
// reader typed. That seam is why the argument exists (DbDataTable.tsx).
//
// CAPPED, AND THE CAP IS VISIBLE. `persons` declares maxPageSize 50, so a full 56,801-row
// export is not one request; this fetches up to EXPORT_MAX rows in pages and tells the
// caller when it stopped short, which the UI reports. Silently truncating an export is the
// "no silent caps" failure — a file that looks complete and is not.

import type { PersonBrowseRow } from "./personBrowseTypes";

/** Hard ceiling on an export. ~11 requests at 50/page; beyond that a reader wants a filter,
 *  not a bigger file. */
export const EXPORT_MAX = 5000;
const PAGE = 50;

const CSV_COLUMNS: { key: keyof PersonBrowseRow; header: string }[] = [
  { key: "slug", header: "slug" },
  { key: "name", header: "name" },
  // A name-fold private (tier V) row has a blank slug and a NAME-match identity — without these
  // two columns a downloaded V row reads as a verified person. 'name_fold' vs 'resolved' is the
  // caveat the table renders as the "по име" badge; it must survive the export.
  { key: "tier", header: "tier" },
  { key: "identityConfidence", header: "identity_confidence" },
  { key: "primaryRole", header: "primary_role" },
  { key: "primaryFacet", header: "primary_facet" },
  { key: "rolesN", header: "roles_n" },
  { key: "partyPrimary", header: "party_primary" },
  { key: "partiesN", header: "parties_n" },
  { key: "placeLabel", header: "place" },
  { key: "oblastCode", header: "oblast_code" },
  { key: "obshtinaCode", header: "obshtina_code" },
  { key: "institution", header: "institution" },
  { key: "latestDeclarationYear", header: "latest_declaration_year" },
  { key: "hasDeclaration", header: "has_declaration" },
  { key: "netWorthEur", header: "net_worth_eur" },
  { key: "companiesN", header: "companies_n" },
  { key: "publicMoneyEur", header: "public_money_eur" },
  // WITHOUT this column the money above is uninterpretable: it says whether the person↔
  // company link was curated ('declared') or matched by name ('mixed' / 'name_match'), which
  // is the caveat the table renders beside the figure. An export that drops it strips the
  // qualification off the number and leaves a bare accusation in a spreadsheet.
  { key: "trLinkBasis", header: "tr_link_basis" },
];

/** RFC-4180 quoting: double every quote, wrap anything containing a delimiter, a quote or a
 *  newline. Bulgarian institution names contain commas and quotes routinely. */
const cell = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const rowsToCsv = (rows: PersonBrowseRow[]): string => {
  const lines = [CSV_COLUMNS.map((c) => c.header).join(",")];
  for (const r of rows)
    lines.push(CSV_COLUMNS.map((c) => cell(r[c.key])).join(","));
  return lines.join("\n");
};

export interface ExportResult {
  csv: string;
  rows: number;
  /** True when EXPORT_MAX stopped the export before the result set ended. */
  truncated: boolean;
}

/** Page through the caller's own query and build the CSV. `request` is the body `onData`
 *  handed back; only page/pageSize are overridden. */
export const fetchPersonsCsv = async (
  request: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ExportResult> => {
  const rows: PersonBrowseRow[] = [];
  let total = Infinity;
  for (let page = 0; rows.length < Math.min(total, EXPORT_MAX); page++) {
    // Same GET-with-?q shape DbDataTable uses — the route takes the request as a
    // URL-encoded JSON query param, not a POST body.
    const body = { ...request, page, pageSize: PAGE };
    const r = await fetch(
      `/api/db/table?q=${encodeURIComponent(JSON.stringify(body))}`,
      { signal },
    );
    if (!r.ok) throw new Error(`export failed: ${r.status}`);
    const j = (await r.json()) as {
      rows: PersonBrowseRow[];
      total: number;
    };
    total = j.total ?? rows.length;
    if (!j.rows?.length) break;
    rows.push(...j.rows);
    if (j.rows.length < PAGE) break;
  }
  const capped = rows.slice(0, EXPORT_MAX);
  return {
    csv: rowsToCsv(capped),
    rows: capped.length,
    truncated: total > capped.length,
  };
};

export const downloadCsv = (csv: string, filename: string): void => {
  // A BOM, so Excel opens Cyrillic as UTF-8 instead of mojibake — the whole file is names.
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};
