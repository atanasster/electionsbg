// МВнР programmatic execution reports watcher. The Bulgarian Ministry of
// Foreign Affairs publishes its "Отчет за изпълнението на програмния
// бюджет" as a ZIP at `mfa.bg/upload/<id>/[Программен|Programen] отчет
// [МВнР|MVnR] <YYYY-period>.zip` (one ZIP per period — Q1 / H1 / 9M /
// year-end). The site's listing page is JS-rendered so curl/HEAD can't
// enumerate it directly; this watcher reads via Wayback Machine CDX
// (statuscode:200 only — same discipline as minfin_program_otchet).
//
// Fingerprint = sha256 of the sorted Wayback URL set with a successful
// capture, deduped by the canonical /upload/<id>/ slug. Flips when
// Wayback caches a new МВнР programmatic ZIP — most often a Q1/H1/Q3
// snapshot, occasionally the year-end annual that warrants adding a new
// EXECUTION_REPORTS entry. The existing `ministry_execution_reports`
// watcher already HEAD-probes the activated МВнР FY2023 URL; this
// watcher complements it by surfacing NEW years (URLs that aren't yet
// in EXECUTION_REPORTS).
//
// Sibling of minfin_program_otchet.ts — same structural pattern.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

const CDX = "https://web.archive.org/cdx/search/cdx";
// Pull every successfully-captured ZIP under mfa.bg/upload/ then filter
// client-side. CDX `urlkey` regex matching is unreliable for Cyrillic
// filenames (the urlkey is percent-encoded), so we don't try; we just
// decode each captured URL and match on the decoded filename below.
const MFA_ZIPS_QUERY =
  "url=www.mfa.bg/upload/&matchType=prefix" +
  "&filter=mimetype:application/zip&filter=statuscode:200" +
  "&limit=5000&output=json";

// 31_12_2023 / 31.12.2023 / 31122023 / 202312 — Bulgarian sources are
// inconsistent on date separators, so match any of them.
const DATE_RE =
  /(\d{1,2})[._-](\d{1,2})[._-](20\d{2})|(\d{2})(\d{2})(20\d{2})|(20\d{2})(\d{2})/;

type CdxRow = [string, string, string, string, string, string, string];

interface Report {
  year: number;
  month: number; // 12 = annual; 6 = H1; 3 = Q1; 9 = Q3
  url: string;
}

const decodeFilename = (url: string): string => {
  try {
    return decodeURIComponent(url.split("/").pop() ?? "").toLowerCase();
  } catch {
    return (url.split("/").pop() ?? "").toLowerCase();
  }
};

const parseDate = (fn: string): { year: number; month: number } | null => {
  const m = DATE_RE.exec(fn);
  if (!m) return null;
  // Shape A: DD.MM.YYYY (m[1..3])
  if (m[1] && m[2] && m[3]) {
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) return { year: Number(m[3]), month };
  }
  // Shape B: DDMMYYYY (m[4..6])
  if (m[4] && m[5] && m[6]) {
    const month = Number(m[5]);
    if (month >= 1 && month <= 12) return { year: Number(m[6]), month };
  }
  // Shape C: YYYYMM (m[7..8]) — МВнР's "202312" style on the inner XLSX
  if (m[7] && m[8]) {
    const month = Number(m[8]);
    if (month >= 1 && month <= 12) return { year: Number(m[7]), month };
  }
  return null;
};

const enumerate = async (): Promise<Report[]> => {
  const rows = await fetchJson<CdxRow[]>(`${CDX}?${MFA_ZIPS_QUERY}`);
  if (!Array.isArray(rows) || rows.length < 2) return [];
  // De-dup by /upload/<id>/ slug — Wayback often has the same file
  // recaptured many times with different timestamps; we only care that
  // SOME successful capture exists.
  const seen = new Map<string, Report>();
  for (const row of rows.slice(1)) {
    const url = row[2].replace(/^http:\/\//, "https://");
    // Skip the "crisis@mfa.bg" misleading-host capture variants (auth-like
    // syntax) — they're the same underlying file.
    if (/^https:\/\/[^/]*@/.test(url)) continue;
    const fn = decodeFilename(url);
    if (!fn) continue;
    // Only accept files whose name actually contains a programmatic-
    // budget keyword (Cyrillic "програмен" single-м, Latin "programen",
    // or "Otchet programi"). Reject the quarterly cash reports
    // ("trimesechen otchet …") whose name doesn't mention programmes.
    if (!/програмен|programen|otchet[_\s-]+programi/i.test(fn)) continue;
    const dt = parseDate(fn);
    if (!dt) continue;
    const slug = url.match(/\/upload\/(\d+)\//)?.[1] ?? url;
    if (seen.has(slug)) continue;
    seen.set(slug, { year: dt.year, month: dt.month, url });
  }
  const out = Array.from(seen.values());
  out.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  return out;
};

const formatLatest = (r: Report | undefined): string => {
  if (!r) return "—";
  const date = `${r.year}-${String(r.month).padStart(2, "0")}`;
  if (r.month === 12) return `${date} (annual)`;
  if (r.month === 6) return `${date} (H1)`;
  if (r.month === 3) return `${date} (Q1)`;
  if (r.month === 9) return `${date} (Q3)`;
  return date;
};

export const mfaProgramOtchet: WatchSource = {
  id: "mfa_program_otchet",
  label: "МВнР programmatic execution reports (via Wayback)",
  url: "https://www.mfa.bg/bg/ministerstvo/dokumenti/otchetnost",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const reports = await enumerate();
    if (reports.length === 0) {
      throw new Error("Wayback CDX returned no МВнР programmatic reports");
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
      return `${delta} new МВнР report(s) · latest ${currLatest} (was ${prevLatest}) — run /update-budget if a new fiscal year`;
    }
    if (delta > 0) {
      return `${delta} new МВнР report(s) · latest ${currLatest}`;
    }
    return `URL set churn (count ${currCount}, latest ${currLatest}) — Wayback re-cached`;
  },
};
