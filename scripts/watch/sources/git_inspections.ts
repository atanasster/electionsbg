// ГИТ — annual labour-inspection activity-report watcher.
//
// ИА „Главна инспекция по труда" (ГИТ) publishes its inspection/violation statistics
// only in the annual „Доклад за дейността" PDF. This watcher fingerprints the set of
// report links on the Activity-Reports listing so a newly published year flips it.
//
// Downstream: update-social re-runs scripts/social/fetch_git_inspections.ts (the
// pdftotext verifier) and updates data/social/git_inspections.json if figures drifted.
//
// Cadence: monthly (the report lands once a year — there is no `yearly` cadence).
// gli.government.bg serves an incomplete cert chain → fetch with insecureTls.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256 } from "../fingerprint";

const GIT_REPORTS_PAGE = "https://www.gli.government.bg/bg/taxonomy/term/370";

// Annual-report links: a report-ish keyword (доклад / godishen / отчет) + .pdf.
const REPORT_LINK =
  /href="([^"]*(?:doklad|godish|godisen|otchet|%D0%B4%D0%BE%D0%BA%D0%BB%D0%B0%D0%B4)[^"]*\.pdf)"/gi;

export const gitInspections: WatchSource = {
  id: "git_inspections",
  label: "ГИТ — доклади за дейността",
  url: GIT_REPORTS_PAGE,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(GIT_REPORTS_PAGE, { insecureTls: true });
    if (!html) return { value: "missing", detail: "fetch failed" };
    const links = Array.from(html.matchAll(REPORT_LINK))
      .map((m) => m[1])
      .sort();
    const years = links
      .flatMap((l) => Array.from(l.matchAll(/\b(20\d{2})\b/g)))
      .map((m) => Number(m[1]));
    const maxYear = years.length ? Math.max(...years) : 0;
    const value = sha256(`${links.length}|${links.join("|")}`);
    return {
      value,
      detail: `${links.length} годишни доклада на ГИТ`,
      meta: { linkCount: links.length, maxYear },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevN = (prev.meta?.linkCount as number | undefined) ?? 0;
    const currN = (curr.meta?.linkCount as number | undefined) ?? 0;
    if (currN > prevN)
      return `нов годишен доклад на ГИТ изглежда е публикуван (${prevN}→${currN}) — пусни update-social да провери data/social/git_inspections.json`;
    return curr.detail;
  },
};
