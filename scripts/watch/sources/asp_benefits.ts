// АСП — annual benefit-disbursement report watcher.
//
// The Agency for Social Assistance (АСП) publishes its benefit statistics only in
// the annual "Годишен отчет за дейността" PDFs (national/annual; no per-oblast
// dataset exists — see docs/plans/social-assistance-view-v1.md §2.1). This watcher
// fingerprints the set of report links on the "Отчети и доклади" listing page, so a
// newly published year's report flips it.
//
// Downstream: update-social re-runs scripts/social/fetch_asp_benefits.ts (the
// pdftotext verifier) and updates data/social/benefits.json if figures drifted.
//
// Cadence: monthly — the report lands once a year (there is no `yearly` cadence).

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256 } from "../fingerprint";

const ASP_REPORTS_PAGE =
  "https://asp.government.bg/bg/za-agentsiyata/misiya-i-tseli/otcheti-i-dokladi/";

// Annual-report links carry a report-ish keyword and a .pdf extension. Recent
// filenames (e.g. 9840-yearlyasp-fin.pdf) omit the year, so change detection keys
// on the LINK SET, not a year in the name. Excludes the ANALIZ* thematic analyses.
const REPORT_LINK =
  /href="([^"]*(?:yearlyasp|godishen|otchet|aspotchet)[^"]*\.pdf)"/gi;

export const aspBenefits: WatchSource = {
  id: "asp_benefits",
  label: "АСП — отчети и доклади",
  url: ASP_REPORTS_PAGE,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(ASP_REPORTS_PAGE);
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
      detail: `${links.length} годишни отчета на АСП`,
      meta: { linkCount: links.length, maxYear },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevN = (prev.meta?.linkCount as number | undefined) ?? 0;
    const currN = (curr.meta?.linkCount as number | undefined) ?? 0;
    if (currN > prevN)
      return `нов годишен отчет на АСП изглежда е публикуван (${prevN}→${currN}) — пусни update-social да провери data/social/benefits.json`;
    return curr.detail;
  },
};
