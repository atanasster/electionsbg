// МО — "Доклад за състоянието на отбраната" + programme-budget watcher.
//
// The Ministry of Defence publishes the annual state-of-defence report and the
// programme-budget execution reports as PDFs on its documents page. Filenames
// carry a date prefix and change each release, so the watcher fingerprints the
// set of PDF links + the highest year on the page.
//
// Downstream: update-defense re-parses readiness figures (vacancy, reserve) into
// data/defense/readiness.json. (The МО budget slice itself rides update-budget's
// per-ministry path, not this skill — see plan §Part-5.)
//
// Cadence: monthly — the state-of-defence report lands once a year; execution
// reports quarterly.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
import { MOD_DOCS_PAGE } from "../../defense/sources";

const PDF_LINK = /href="([^"]*\.pdf)"/gi;

export const modDefenseReport: WatchSource = {
  id: "mod_defense_report",
  label: "МО — доклад за отбраната",
  url: MOD_DOCS_PAGE,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(MOD_DOCS_PAGE);
    if (!html) return { value: "missing", detail: "fetch failed" };
    const links = Array.from(html.matchAll(PDF_LINK))
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
      detail: `${links.length} МО PDFs · latest year ${maxYear}`,
      meta: { maxYear, linkCount: links.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevN = (prev.meta?.linkCount as number | undefined) ?? 0;
    const currN = (curr.meta?.linkCount as number | undefined) ?? 0;
    if (currN !== prevN)
      return `МО documents changed: ${prevN} → ${currN} PDFs — run update-defense to refresh readiness`;
    return curr.detail;
  },
};
