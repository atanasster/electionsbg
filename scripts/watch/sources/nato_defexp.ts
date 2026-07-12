// NATO — "Defence Expenditure of NATO Countries" watcher.
//
// NATO publishes the annual report as a PDF (def-exp-YYYY-en.pdf) linked from its
// news pages. The filename carries the edition year and changes yearly, so the
// watcher fingerprints the set of def-exp-*.pdf links + the highest year rather
// than probing a fixed URL.
//
// Downstream: update-defense re-parses Tables 3 & 8a (via pdftotext -layout) into
// data/defense/gdp_share.json + category_split.json.
//
// Cadence: monthly — the report lands once a year without a fixed week.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
import { NATO_DEFEXP_PAGE } from "../../defense/sources";

const PDF_LINK = /href="([^"]*def-exp[^"]*\.pdf)"/gi;

export const natoDefexp: WatchSource = {
  id: "nato_defexp",
  label: "НАТО — разходи за отбрана",
  url: NATO_DEFEXP_PAGE,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(NATO_DEFEXP_PAGE);
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
      detail: `${links.length} def-exp PDFs · latest edition ${maxYear}`,
      meta: { maxYear, linkCount: links.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevYear = (prev.meta?.maxYear as number | undefined) ?? 0;
    const currYear = (curr.meta?.maxYear as number | undefined) ?? 0;
    if (currYear > prevYear)
      return `NATO Defence Expenditure ${currYear} edition appears to have landed (was ${prevYear}) — run update-defense to re-parse Tables 3 & 8a`;
    return curr.detail;
  },
};
