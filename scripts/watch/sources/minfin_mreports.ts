// Minfin КФП monthly bulletins watcher. The Bulgarian Ministry of Finance
// publishes the fiscal-reserve figure in three parallel filename series under
// /upload/: `mreport_<MonthName><YYYY>_bg.pdf` (Институт за анализи и
// прогнози monthly economic review, КФП table), `BULETIN_<MonthName>_
// <YYYY>.pdf` (Информационен бюлетин — Изпълнение на държавния бюджет, a
// narrative press-bulletin), and `FRA-MM-YYYY-(BG|EN).xlsx` (the
// authoritative single-month spreadsheet from the dedicated /bg/statistics/4
// page). All three feed the fiscal-reserve series on /indicators. Live
// minfin.bg is Cloudflare-blocked, so we read everything indirectly via
// Wayback Machine CDX.
//
// Fingerprint = sha256 of the sorted union of all three series with a
// successful capture (statuscode 200). A flip means Wayback caught a new
// bulletin / xlsx (or re-captured an older one) — both warrant re-running
// the fiscal-reserve fetch since each mreport carries ~12 months of rolling
// data, each BULETIN carries one end-of-month figure, and each FRA xlsx
// carries one authoritative end-of-month total.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

const CDX = "https://web.archive.org/cdx/search/cdx";
// Both queries filter `statuscode:200` so unusable Cloudflare-challenge
// captures (HTTP 403 + text/html body) don't inflate the count or
// fingerprint. Limit 2000 is enough for both series.
const MREPORT_QUERY =
  "url=www.minfin.bg/upload/&matchType=prefix" +
  "&filter=mimetype:application/pdf&filter=statuscode:200" +
  "&filter=urlkey:.*mreport.*&limit=2000&output=json";
const BULETIN_QUERY =
  "url=www.minfin.bg/upload/&matchType=prefix" +
  "&filter=mimetype:application/pdf&filter=statuscode:200" +
  "&filter=urlkey:.*buletin_.*&limit=2000&output=json";
const FRA_XLSX_QUERY =
  "url=www.minfin.bg/upload/&matchType=prefix" +
  "&filter=statuscode:200&filter=urlkey:.*fra-.*\\.xlsx" +
  "&limit=2000&output=json";

const MREPORT_RE = /mreport_\+?([a-z]+?)[-_]?(20\d{2})_?\+?_?bg/i;
const BULETIN_RE = /BULETIN_([A-Za-z]+)_?\+?_?(20\d{2})\.pdf$/i;
const FRA_XLSX_RE = /FRA-(\d{2})-(\d{4})-(BG|EN)\.xlsx$/i;
const MONTH_LOOKUP: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  noe: 11,
  november: 11,
  dec: 12,
  december: 12,
};

type CdxRow = [string, string, string, string, string, string, string];

interface Bulletin {
  year: number;
  month: number;
  url: string;
  series: "mreport" | "buletin" | "fr_xlsx";
}

const enumerate = async (): Promise<Bulletin[]> => {
  const [mreportRows, buletinRows, fraXlsxRows] = await Promise.all([
    fetchJson<CdxRow[]>(`${CDX}?${MREPORT_QUERY}`),
    fetchJson<CdxRow[]>(`${CDX}?${BULETIN_QUERY}`),
    fetchJson<CdxRow[]>(`${CDX}?${FRA_XLSX_QUERY}`),
  ]);
  const seen = new Set<string>();
  const out: Bulletin[] = [];

  const ingest = (
    rows: CdxRow[] | null,
    series: "mreport" | "buletin" | "fr_xlsx",
  ): void => {
    if (!Array.isArray(rows) || rows.length < 2) return;
    for (const row of rows.slice(1)) {
      const url = row[2].replace(/^http:\/\//, "https://");
      if (seen.has(url)) continue;
      seen.add(url);
      const fn = url.split("/").pop() ?? "";
      if (series === "mreport") {
        const lower = fn.toLowerCase();
        if (!lower.includes("_bg")) continue;
        if (lower.includes("july-aug") || lower.includes("jul-aug")) continue;
        const m = MREPORT_RE.exec(lower);
        if (!m) continue;
        const month =
          MONTH_LOOKUP[m[1].toLowerCase()] ??
          MONTH_LOOKUP[m[1].slice(0, 3).toLowerCase()];
        if (!month) continue;
        out.push({ year: Number(m[2]), month, url, series });
      } else if (series === "buletin") {
        const m = BULETIN_RE.exec(fn);
        if (!m) continue;
        const month = MONTH_LOOKUP[m[1].toLowerCase()];
        if (!month) continue;
        out.push({ year: Number(m[2]), month, url, series });
      } else {
        const m = FRA_XLSX_RE.exec(fn);
        if (!m) continue;
        const month = Number(m[1]);
        if (month < 1 || month > 12) continue;
        out.push({ year: Number(m[2]), month, url, series });
      }
    }
  };

  ingest(mreportRows, "mreport");
  ingest(buletinRows, "buletin");
  ingest(fraXlsxRows, "fr_xlsx");
  out.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  return out;
};

const formatLatest = (b: Bulletin | undefined): string => {
  if (!b) return "—";
  return `${b.year}-${String(b.month).padStart(2, "0")}`;
};

export const minfinMreports: WatchSource = {
  id: "minfin_mreports",
  label: "Minfin КФП monthly bulletins (via Wayback)",
  url: "https://www.minfin.bg/bg/statistics/5",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const bulletins = await enumerate();
    if (bulletins.length === 0) {
      throw new Error("Wayback CDX returned no minfin mreport bulletins");
    }
    const latest = bulletins[bulletins.length - 1];
    // Hash the full URL set so a newly-crawled OLDER bulletin still flips
    // the fingerprint — those carry months we may not yet have ingested.
    const value = createHash("sha256")
      .update(bulletins.map((b) => b.url).join("\n"))
      .digest("hex");
    return {
      value,
      detail: `${bulletins.length} bulletins cached · latest ${formatLatest(latest)}`,
      meta: {
        count: bulletins.length,
        latestYear: latest.year,
        latestMonth: latest.month,
      },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    if (prev.fingerprint === curr.value) return curr.detail;
    const prevCount = Number(prev.meta?.count ?? 0);
    const currCount = Number(curr.meta?.count ?? 0);
    const delta = currCount - prevCount;
    const prevLatest = `${prev.meta?.latestYear ?? "?"}-${String(prev.meta?.latestMonth ?? "?").padStart(2, "0")}`;
    const currLatest = `${curr.meta?.latestYear ?? "?"}-${String(curr.meta?.latestMonth ?? "?").padStart(2, "0")}`;
    if (delta > 0 && currLatest !== prevLatest) {
      return `${delta} new bulletin(s) cached · latest ${currLatest} (was ${prevLatest})`;
    }
    if (delta > 0) {
      return `${delta} new bulletin(s) cached · latest ${currLatest}`;
    }
    return `URL set churn (count ${currCount}, latest ${currLatest}) — Wayback re-cached one or more bulletins`;
  },
};
