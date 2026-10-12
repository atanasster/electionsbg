// НСИ — „Относителен дял на населението с водни услуги" (Statistics of waters,
// timeseries Ecology_9.8): the national series behind the /water services
// figures — population under воден режим, connected to public water supply,
// connected to wastewater treatment. data/water/water_stats.json is built from it
// by `npm run water:stats -- --refresh`.
//
// Until 2026-10-12 nothing watched this file, so a new НСИ year could only reach
// the site by someone remembering to look (docs/plans/water-hub-v1.md G5).
//
// The fingerprint is the PARSED year spine plus the latest year's values, not the
// raw bytes: NSI re-saves its XLSX with fresh metadata, and a byte hash would flip
// on every re-save that changed no number.

import { createHash } from "crypto";
import * as XLSX from "xlsx";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const URL =
  "https://www.nsi.bg/sites/default/files/files/data/timeseries/Ecology_9.8.xlsx";
const UA = "Mozilla/5.0 (compatible; electionsbg-indicators/1.0)";

const isYear = (c: unknown): boolean => {
  const y = Number(c);
  return Number.isInteger(y) && y >= 2000 && y <= 2100;
};

export const nsiWaterStats: WatchSource = {
  id: "nsi_water_stats",
  label: "НСИ: Население с водни услуги / воден режим (Ecology_9.8)",
  url: URL,
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const res = await fetch(URL, { headers: { "User-Agent": UA } });
    if (!res.ok)
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${URL}`);
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()));
    const sheet = wb.Sheets["9.8.1. POP BG"] ?? wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
    });
    const yearRow = rows.find((r) => r.slice(1).some(isYear));
    if (!yearRow)
      // Fail loud: a layout change must not read as "no new year".
      throw new Error(
        "nsi_water_stats: no year row in Ecology_9.8 — NSI layout may have changed",
      );
    const cols = yearRow
      .map((c, col) => ({ col, year: Number(c) }))
      .filter(({ year }) => isYear(year));
    const last = cols[cols.length - 1];
    const latest = rows
      .filter((r) => typeof r[0] === "string" && String(r[0]).trim())
      .map((r) => `${String(r[0]).trim()}=${r[last.col] ?? ""}`);
    const serialised = [cols.map((c) => c.year).join(","), ...latest].join(
      "\n",
    );
    return {
      value: createHash("sha256").update(serialised).digest("hex"),
      detail: `${cols.length} years · latest ${last.year}`,
      meta: { latestYear: last.year },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const was = prev?.meta?.latestYear as number | undefined;
    const now = curr.meta?.latestYear as number | undefined;
    if (was && now && was !== now)
      return `new year published: ${now} (was ${was}) — run npm run water:stats -- --refresh`;
    if (prev)
      return `${curr.detail} — values revised; run npm run water:stats -- --refresh`;
    return curr.detail;
  },
};
