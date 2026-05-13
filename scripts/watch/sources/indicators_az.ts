// AZ (Агенция по заетостта) annual unemployment watcher.
// Fingerprints the /stats/4/ listing — when AZ publishes a new annual
// review (typically Q1 of the following year), the year-keyed inventory
// changes and this watcher fires "new release · 2026 …".
//
// We deliberately fingerprint only the listing HTML, not the XLSX inside
// each review. The listing changes when AZ adds a year; subsequent
// re-uploads of the SAME year's file don't change the listing and
// shouldn't trigger /update-indicators. If a re-upload corrects values
// we re-ingest manually.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";

const STATS_PAGE = "https://www.az.government.bg/stats/4/";

const collectYearLinks = (html: string): Record<string, string> => {
  // Year markers (20\d\d) and per-review links (view/4/<id>) interleave in
  // the listing. Walk in order, tracking the most-recent year as the
  // context for the next link encountered.
  const re =
    /(20\d\d)|<a[^>]+href="https:\/\/www\.az\.government\.bg\/bg\/stats\/view\/4\/(\d+)\/"/g;
  const byYear: Record<string, string> = {};
  let currentYear: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) currentYear = m[1];
    else if (m[2] && currentYear && !byYear[currentYear]) {
      byYear[currentYear] = m[2];
    }
  }
  return byYear;
};

export const indicatorsAz: WatchSource = {
  id: "indicators_az",
  label: "AZ (Агенция по заетостта): annual unemployment reviews",
  url: STATS_PAGE,
  // Annual cadence (one new review per year, ~Q1). Daily polling is
  // overkill but consistent with the rest of the watcher infra.
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(STATS_PAGE);
    if (!html) throw new Error(`empty response from ${STATS_PAGE}`);
    const byYear = collectYearLinks(html);
    const years = Object.keys(byYear).sort();
    const serialised = years.map((y) => `${y}:${byYear[y]}`).join("|");
    const value = createHash("sha256").update(serialised).digest("hex");
    const latestYear = years.at(-1) ?? "—";
    return {
      value,
      detail: `${years.length} annual reviews · latest ${latestYear}`,
      meta: { byYear, latestYear },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevYears = (prev.meta?.byYear ?? {}) as Record<string, string>;
    const currYears = (curr.meta?.byYear ?? {}) as Record<string, string>;
    const added: string[] = [];
    const changed: string[] = [];
    for (const y of Object.keys(currYears)) {
      if (!prevYears[y]) added.push(y);
      else if (prevYears[y] !== currYears[y]) changed.push(y);
    }
    if (added.length === 0 && changed.length === 0) return curr.detail;
    const parts: string[] = [];
    if (added.length > 0) parts.push(`new year(s) ${added.join(", ")}`);
    if (changed.length > 0) parts.push(`updated year(s) ${changed.join(", ")}`);
    return parts.join(" · ");
  },
};
