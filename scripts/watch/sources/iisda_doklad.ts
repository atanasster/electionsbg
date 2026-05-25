// IISDA annual report listing — surfaces a new "Доклад за състоянието на
// администрацията" publication. Each year's report is at
// iisda.government.bg/annual_report/<id>; the listing page lists every
// report with its id. Fingerprint = sha256 of the sorted list of report
// ids whose title matches the main Доклад phrase.
//
// When a new id appears, /update-budget should be re-run AFTER adding the
// new id+file id to DOKLAD_FILE_IDS in scripts/budget/doklad.ts (resolve
// the file id by visiting the landing page).
//
// Cadence is weekly — a Доклад publishes once a year (typically April-May),
// so anything faster is wasted polling.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const LIST_URL = "https://iisda.government.bg/annual_reports";
const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; " +
  "+https://electionsbg.com)";

// Extract the "annual_report/<id>" pairs for the main Доклад series (the
// title contains "Доклад за състоянието на администрацията"). Each report
// in the listing has a year suffix ("през 2024 г.") which we capture so the
// fingerprint detail can be human-readable.
const fetchReports = async (): Promise<Array<{ id: string; year: string }>> => {
  const res = await fetch(LIST_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${LIST_URL}`);
  const html = await res.text();
  const out: Array<{ id: string; year: string }> = [];
  const re =
    /annual_report\/(\d+)">\s*Доклад\s+за\s+състоянието\s+на\s+администрацията\s+през\s+(\d{4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push({ id: m[1], year: m[2] });
  }
  // De-dup (the listing renders each entry twice in the HTML).
  const seen = new Set<string>();
  return out.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
};

export const iisdaDoklad: WatchSource = {
  id: "iisda_doklad",
  label: "Доклад за състоянието на администрацията (IISDA)",
  url: LIST_URL,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const reports = await fetchReports();
    const sorted = reports.map((r) => `${r.year}=${r.id}`).sort();
    const value = createHash("sha256")
      .update(sorted.join("|"))
      .digest("hex")
      .slice(0, 16);
    const years = reports.map((r) => r.year).sort();
    return {
      value,
      detail: `${reports.length} report(s) ${years[0]}–${years[years.length - 1]}, hash ${value}`,
      meta: { reports: Object.fromEntries(reports.map((r) => [r.year, r.id])) },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevMap = (prev.meta?.reports as Record<string, string>) ?? {};
    const currMap = (curr.meta?.reports as Record<string, string>) ?? {};
    const added: string[] = [];
    for (const [year, id] of Object.entries(currMap)) {
      if (prevMap[year] !== id) added.push(year);
    }
    if (added.length === 0) return `${curr.detail} (no new years)`;
    return (
      `Доклад: new/updated report(s) for ${added.join(", ")} — ` +
      `resolve file id from /annual_report/<id>, add to DOKLAD_FILE_IDS, run /update-budget`
    );
  },
};
