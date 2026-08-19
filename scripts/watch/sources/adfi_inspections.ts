// Watch АДФИ's inspection listing. Maps to `update-procurement`.
//
// The fingerprint is over the REPORT URLs, which are per-inspection and stable —
// not over the HTML, which is a CMS page that churns for unrelated reasons.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
import { ADFI_PAGES, BROWSER_UA } from "../../procurement/adfi/sources";
import { parseAdfiTable } from "../../procurement/adfi/parse";

export const adfiInspections: WatchSource = {
  id: "adfi_inspections",
  label: "АДФИ — доклади от финансови инспекции (adfi.minfin.bg)",
  url: ADFI_PAGES[0].url,
  cadence: "weekly",
  // АДФИ publishes a report when an inspection closes, on no schedule.
  publishes: "irregular",

  async fingerprint(): Promise<Fingerprint> {
    const page = ADFI_PAGES[0];
    const html = await fetchText(page.url, {
      headers: { "User-Agent": BROWSER_UA },
    });
    // Unreachable is not „no inspections". Throw so the watcher's own
    // source-down path handles it rather than reporting a collapse.
    if (!html) throw new Error("АДФИ listing unreachable — a probe failure");
    const urls = parseAdfiTable(html, page.url)
      .map((r) => r.reportUrl)
      .sort();
    if (!urls.length)
      throw new Error(
        "АДФИ listing parsed to zero reports — page shape changed",
      );
    return {
      value: createHash("sha256").update(urls.join("\n")).digest("hex"),
      detail: `${urls.length.toLocaleString()} inspection reports listed`,
      meta: { count: urls.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const a = Number((prev.meta as { count?: number } | undefined)?.count ?? 0);
    const b = Number((curr.meta as { count?: number } | undefined)?.count ?? 0);
    if (b > a) return `${b - a} new financial inspection report(s)`;
    // АДФИ does not withdraw reports, so a fall is the page changing, not
    // inspections being undone.
    if (b < a)
      return `${b} reports listed, down from ${a} — АДФИ does not withdraw reports, so the listing has changed`;
    return "a listed report was amended (count unchanged)";
  },
};
