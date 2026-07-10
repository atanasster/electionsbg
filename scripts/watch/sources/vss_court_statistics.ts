// Висш съдебен съвет — "Съдебна статистика, регистри" watcher.
//
// The ВСС publishes the annual "Обобщени статистически таблици за дейността на
// съдилищата" as a PDF, plus a half-year edition, on one long listing page. The
// filenames are NOT uniform across years (total-tables-YYYY.pdf, otchet-YYYY.pdf,
// Statistika-YYYY.pdf …), so the watcher fingerprints the SET of annual-table
// links rather than probing a predictable URL.
//
// Downstream: `update-judiciary` re-runs scripts/judiciary/__write_caseload.ts,
// which parses Приложение № 1 (case movement + judges' workload) out of each
// year's PDF into data/judiciary/caseload.json. When a new year appears the
// operator adds it to VSS_ANNUAL_TABLES in scripts/judiciary/sources.ts first —
// the map is curated precisely because the URLs are unpredictable.
//
// Cadence: monthly — the annual tables land once a year, without a fixed week.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
// Single-sourced with the ingest: if the ВСС moves the page, updating
// VSS_STATS_PAGE keeps the watcher and the parser pointing at the same URL —
// otherwise the watcher silently fingerprints a dead page forever and never
// flags the new year's publication.
import { VSS_STATS_PAGE } from "../../judiciary/sources";

/** Links that look like an annual/half-year summary-tables PDF. */
const TABLE_LINK =
  /href="([^"]*(?:total-tables|otchet|Statistika|STAT_TABLICI|stat-|Obobshteni)[^"]*\.pdf)"/gi;

export const vssCourtStatistics: WatchSource = {
  id: "vss_court_statistics",
  label: "ВСС — съдебна статистика",
  url: VSS_STATS_PAGE,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(VSS_STATS_PAGE);
    if (!html) return { value: "missing", detail: "fetch failed" };
    const links = Array.from(html.matchAll(TABLE_LINK))
      .map((m) => m[1])
      .sort();
    // The newest annual table carries the highest 4-digit year in its filename.
    const years = links
      .flatMap((l) => Array.from(l.matchAll(/\b(20\d{2})\b/g)))
      .map((m) => Number(m[1]));
    const maxYear = years.length ? Math.max(...years) : 0;
    const value = createHash("sha256")
      .update(`${maxYear}|${links.length}|${links.join("|")}`)
      .digest("hex");
    return {
      value,
      detail: `${links.length} statistics PDFs · latest year ${maxYear}`,
      meta: { maxYear, linkCount: links.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevYear = (prev.meta?.maxYear as number | undefined) ?? 0;
    const currYear = (curr.meta?.maxYear as number | undefined) ?? 0;
    if (currYear > prevYear)
      return `ВСС court statistics for ${currYear} appear to have landed (was ${prevYear}) — add the new PDF URL to VSS_ANNUAL_TABLES, then run update-judiciary`;
    const prevN = (prev.meta?.linkCount as number | undefined) ?? 0;
    const currN = (curr.meta?.linkCount as number | undefined) ?? 0;
    if (currN !== prevN)
      return `statistics PDF list changed: ${prevN} → ${currN} links`;
    return curr.detail;
  },
};
