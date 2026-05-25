// Minfin programme-budget execution reports watcher. The Bulgarian Ministry
// of Finance publishes its "Отчет за изпълнението на програмния бюджет" at
// `minfin.bg/upload/<id>/1000_Pril-1-MoF_[draft+]ProgOtchet[_]<DATE>[_Official].pdf`.
// The live site is Cloudflare-blocked, so the operator (or this watcher)
// reads the file via Wayback Machine. Two annual snapshots per year usually
// surface: 30.06 (semi-annual) and 31.12 (final). We care about the 31.12
// annual file — that's the one the personnel pipeline ingests.
//
// Fingerprint = sha256 of the sorted Wayback URL set with a successful
// (statuscode:200) capture. Flips when Wayback caches a new (or re-caches an
// older) annual MoF programme-budget execution report — both warrant
// re-running /update-budget so the operator can backfill into
// raw_data/budget/exec-admin-ministerstvoto-na-finansite-<fy>.pdf and add a
// manual-pdf entry to EXECUTION_REPORTS.
//
// This is a SIBLING to minfin_mreports — that watcher tracks monthly
// КФП bulletins (fiscal-reserve series). This one tracks the per-ministry
// programme-budget execution reports, which is a separate publication line.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

const CDX = "https://web.archive.org/cdx/search/cdx";
const PROGOTCHET_QUERY =
  "url=www.minfin.bg/upload/&matchType=prefix" +
  "&filter=mimetype:application/pdf&filter=statuscode:200" +
  "&filter=urlkey:.*progotchet.*&limit=2000&output=json";

// 1000_Pril-1-MoF_draft+ProgOtchet_31.12.2023_Official.pdf
// 1000_Pril-1-MoF_ProgOtchet_30.06.2023_Official.pdf
// 1000_Pril-1-MoF_draft+ProgOtchet+_+31+12+2013.pdf  (older layout uses + for spaces)
const DATE_RE = /(\d{1,2})[.+_-](\d{1,2})[.+_-](20\d{2})/;

type CdxRow = [string, string, string, string, string, string, string];

interface Report {
  year: number;
  month: number; // 6 for 30.06 (H1), 12 for 31.12 (annual)
  url: string;
}

const enumerate = async (): Promise<Report[]> => {
  const rows = await fetchJson<CdxRow[]>(`${CDX}?${PROGOTCHET_QUERY}`);
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const seen = new Set<string>();
  const out: Report[] = [];
  for (const row of rows.slice(1)) {
    const url = row[2].replace(/^http:\/\//, "https://");
    if (seen.has(url)) continue;
    seen.add(url);
    const fn = decodeURIComponent(url.split("/").pop() ?? "");
    if (!/progotchet/i.test(fn)) continue;
    const m = DATE_RE.exec(fn);
    if (!m) continue;
    const month = Number(m[2]);
    if (month < 1 || month > 12) continue;
    out.push({ year: Number(m[3]), month, url });
  }
  // Newest last
  out.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  return out;
};

const formatLatest = (r: Report | undefined): string => {
  if (!r) return "—";
  const date = `${r.year}-${String(r.month).padStart(2, "0")}`;
  return r.month === 12 ? `${date} (annual)` : `${date} (H1)`;
};

export const minfinProgramOtchet: WatchSource = {
  id: "minfin_program_otchet",
  label: "Minfin programme-budget execution reports (via Wayback)",
  url: "https://www.minfin.bg/bg/725",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const reports = await enumerate();
    if (reports.length === 0) {
      throw new Error("Wayback CDX returned no minfin ProgOtchet reports");
    }
    const latest = reports[reports.length - 1];
    const value = createHash("sha256")
      .update(reports.map((r) => r.url).join("\n"))
      .digest("hex");
    return {
      value,
      detail: `${reports.length} report(s) cached · latest ${formatLatest(latest)}`,
      meta: {
        count: reports.length,
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
      return `${delta} new MoF report(s) · latest ${currLatest} (was ${prevLatest}) — run /update-budget`;
    }
    if (delta > 0) {
      return `${delta} new MoF report(s) · latest ${currLatest} — run /update-budget`;
    }
    return `URL set churn (count ${currCount}, latest ${currLatest}) — Wayback re-cached`;
  },
};
