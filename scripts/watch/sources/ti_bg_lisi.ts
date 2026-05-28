// Transparency International Bulgaria — Local Integrity System Index
// (LISI) watcher.
//
// TI-BG publishes the LISI annually for the 27 oblast-center municípios
// (Burgas, Sofia, Plovdiv, …). The interactive dashboard at
// lisi.transparency.bg surfaces the latest year prominently. We
// fingerprint the page body to catch year-rollovers.
//
// Downstream `update-transparency-lisi` (scripts/transparency/build_lisi.ts)
// rewrites data/municipal_transparency/index.json with the latest 27 scores
// once an operator confirms the new figures in the dashboard. The scrape
// is manual today — the dashboard is a heavy SPA whose state isn't easy
// to extract programmatically — so the watcher's job is just to flag
// "year rolled, copy fresh numbers into the LISI_2024 array".
//
// Cadence: monthly — TI-BG publishes once a year, but the report drops
// without a fixed calendar week so monthly is the right granularity.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";

const URL = "https://lisi.transparency.bg/";

export const tiBgLisi: WatchSource = {
  id: "ti_bg_lisi",
  label: "Прозрачност без граници — LISI",
  url: URL,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(URL);
    if (!html) return { value: "missing", detail: "fetch failed" };
    // The page mentions year ranges (e.g. "2015-2024"). Extract the max
    // 4-digit year seen on the page as the primary signal.
    const years = Array.from(html.matchAll(/\b(20\d{2})\b/g)).map((m) =>
      Number(m[1]),
    );
    const maxYear = years.length ? Math.max(...years) : 0;
    // Fingerprint = (maxYear, page-body hash) so we catch both year
    // rollover and dashboard content updates within the same year.
    const value = createHash("sha256")
      .update(`${maxYear}|${html.length}|${html.slice(0, 2000)}`)
      .digest("hex");
    return {
      value,
      detail: `latest year on page: ${maxYear}`,
      meta: { maxYear },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevYear = (prev.meta?.maxYear as number | undefined) ?? 0;
    const currYear = (curr.meta?.maxYear as number | undefined) ?? 0;
    if (currYear > prevYear) {
      return `LISI ${currYear} appears to have landed (was ${prevYear})`;
    }
    return curr.detail;
  },
};
