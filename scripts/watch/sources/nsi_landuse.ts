// НСИ — annual "Land use distribution of the Republic of Bulgaria"
// press-release annex. Source pattern: `/bg/statistical-data/45` lists
// every upcoming release in an HTML table inside the "Предстоящи
// прессъобщения и данни" accordion. The latest entry shifts out of
// "upcoming" the day the new release publishes (typically June of the
// following year), so fingerprinting that table catches the change
// reliably without us having to discover the opaque PDF token.
//
// We hash the raw rows of the upcoming-releases accordion. Page chrome
// (nav, scripts) is excluded — otherwise unrelated edits to the NSI
// template would emit false-positive flips. A regression-proof
// fingerprint that survives whitespace and minor tag tweaks.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const PAGE_URL = "https://www.nsi.bg/bg/statistical-data/45";
const UA = "electionsbg.com data pipeline";

interface UpcomingRow {
  date: string;
  name: string;
}

const fetchHtml = async (url: string): Promise<string> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return res.text();
};

// Pull every <tr>…<td>date</td><td>name</td>…</tr> from the upcoming
// accordion. We can't rely on stable class names — NSI's CMS rotates
// them — so we just locate the section by its header text and read
// the first <table> after it.
const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const extractUpcomingRows = (html: string): UpcomingRow[] => {
  // The accordion sits between the "Предстоящи прессъобщения" heading
  // and the next accordion ("Контакти" / "Прессъобщения") — match the
  // first <table>…</table> after the heading.
  const i = html.search(/Предстоящи\s+прессъобщения/);
  if (i < 0) return [];
  const after = html.slice(i);
  const tblMatch = /<table\b[\s\S]*?<\/table>/i.exec(after);
  if (!tblMatch) return [];
  const tbl = tblMatch[0];
  const rows: UpcomingRow[] = [];
  const rowRx = /<tr\b[\s\S]*?<\/tr>/gi;
  for (const rowMatch of tbl.matchAll(rowRx)) {
    const tds = [...rowMatch[0].matchAll(/<td\b[\s\S]*?<\/td>/gi)].map((m) =>
      stripTags(m[0]),
    );
    if (tds.length < 2) continue;
    rows.push({ date: tds[0], name: tds[1] });
  }
  return rows;
};

export const nsiLanduse: WatchSource = {
  id: "nsi_landuse",
  label: "НСИ: Баланс на територията (LANDUSE annex)",
  url: PAGE_URL,
  // Annual cadence; daily polling is cheap (~240 KB page) and matches
  // the rest of the NSI watchers. The fingerprint is stable between
  // releases so consecutive runs are no-ops.
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchHtml(PAGE_URL);
    const rows = extractUpcomingRows(html);
    if (rows.length === 0) {
      // If NSI ever drops the upcoming table we'd lose detection
      // entirely — fail loud so we don't pretend everything's fine.
      throw new Error(
        "nsi_landuse: no upcoming-release rows extracted; NSI page layout may have changed",
      );
    }
    const serialised = rows.map((r) => `${r.date}|${r.name}`).join("\n");
    const value = createHash("sha256").update(serialised).digest("hex");
    const upcoming = rows.map((r) => `${r.date}: ${r.name}`).join("; ");
    return {
      value,
      detail: `${rows.length} upcoming · ${upcoming}`,
      meta: { rows },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevRows = (prev.meta?.rows ?? []) as UpcomingRow[];
    const currRows = (curr.meta?.rows ?? []) as UpcomingRow[];
    const prevKey = (r: UpcomingRow) => `${r.date}|${r.name}`;
    const prevSet = new Set(prevRows.map(prevKey));
    const currSet = new Set(currRows.map(prevKey));
    const removed = prevRows.filter((r) => !currSet.has(prevKey(r)));
    const added = currRows.filter((r) => !prevSet.has(prevKey(r)));
    const parts: string[] = [];
    for (const r of removed)
      parts.push(`released: ${r.date} (${r.name.slice(0, 80)})`);
    for (const r of added)
      parts.push(`scheduled: ${r.date} (${r.name.slice(0, 80)})`);
    if (parts.length === 0) return curr.detail;
    return parts.join("; ");
  },
};
