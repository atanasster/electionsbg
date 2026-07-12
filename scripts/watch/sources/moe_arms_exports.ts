// Ministry of Economy — annual arms-export control report watcher.
//
// The Ministry of Economy's annual report on the control of the export of
// defence-related products is the authoritative euro figure for Bulgaria's arms
// exports (SIPRI TIV undercounts it because it excludes ammunition). SIPRI's
// national-reports page for Bulgaria mirrors the report links, so the watcher
// fingerprints the set of report links + the highest year there.
//
// Downstream: update-defense refreshes data/defense/exports.json.
//
// Cadence: monthly — the report lands once a year.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
import { MOE_EXPORT_PAGE } from "../../defense/sources";

// Require a report-ish keyword AND a document extension, so bare navigation
// PDFs and query strings carrying "export" don't count as report links (they
// were inflating linkCount and could bump maxYear off an unrelated document).
const REPORT_LINK =
  /href="([^"]*(?:report|doklad|iznos|export)[^"]*\.(?:pdf|docx?|xlsx?))"/gi;

export const moeArmsExports: WatchSource = {
  id: "moe_arms_exports",
  label: "МИ — износ на оръжие",
  url: MOE_EXPORT_PAGE,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(MOE_EXPORT_PAGE);
    if (!html) return { value: "missing", detail: "fetch failed" };
    const links = Array.from(html.matchAll(REPORT_LINK))
      .map((m) => m[1])
      .sort();
    const years = links
      .flatMap((l) => Array.from(l.matchAll(/\b(20\d{2})\b/g)))
      .map((m) => Number(m[1]));
    const maxYear = years.length ? Math.max(...years) : 0;
    const value = createHash("sha256")
      .update(`${maxYear}|${links.length}|${links.join("|")}`)
      .digest("hex");
    return {
      value,
      detail: `${links.length} export-report links · latest year ${maxYear}`,
      meta: { maxYear, linkCount: links.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevYear = (prev.meta?.maxYear as number | undefined) ?? 0;
    const currYear = (curr.meta?.maxYear as number | undefined) ?? 0;
    if (currYear > prevYear)
      return `a ${currYear} arms-export report appears to have landed (was ${prevYear}) — run update-defense to refresh exports.json`;
    return curr.detail;
  },
};
