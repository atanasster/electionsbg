// Minfin government-debt monthly bulletin watcher — the automated signal for
// new international Eurobond issuances.
//
// The international Eurobond list on /indicators/fiscal is hand-curated in
// data/debt-emissions.json (the domestic ДЦК auctions are auto-scraped from
// BNB by a separate watcher — see bnb_auctions.ts). Nothing previously
// watched the Eurobond side, so a syndicated placement (e.g. the July 2026
// €2.5bn issue) only surfaced when a human spotted a news article. This
// watcher closes that gap: every Eurobond lands in the Ministry of Finance
// monthly "Държавен дълг" bulletin, so a new bulletin is our trigger to go
// read it and hand-add any new international emission.
//
// Source: https://www.minfin.bg/bg/statistics/20 — the MoF publishes one
// PDF per month, `(C)GD-bulletin_debt_bg+MM-YYYY.pdf` under /upload/. Live
// minfin.bg is Cloudflare-blocked (see minfin_mreports.ts), so — exactly
// like that watcher — we enumerate the series indirectly via Wayback Machine
// CDX. CAVEAT: Wayback only holds a URL once it has crawled it, so this
// watcher lags real publication by however long Wayback takes to capture the
// new bulletin (weeks, occasionally longer). It is the robust *automated*
// path, not a same-day alert; when it flips, update-macro reads the latest
// bulletin and reconciles data/debt-emissions.json.
//
// Fingerprint = sha256 of the sorted union of every bg-language debt-bulletin
// URL Wayback has captured. A flip means a new (or re-crawled older) bulletin
// appeared — either way worth re-checking the Eurobond list.
//
// Cadence: monthly. The bulletin is monthly and Eurobonds are rare.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

const CDX = "https://web.archive.org/cdx/search/cdx";
// `statuscode:200` drops unusable Cloudflare-challenge captures. The urlkey
// filter matches both the modern `CGD-bulletin_debt...` and the older
// `GD-bulletin_debt...` filenames. bg/en split is resolved in code below.
const BULLETIN_QUERY =
  "url=www.minfin.bg/upload/&matchType=prefix" +
  "&filter=mimetype:application/pdf&filter=statuscode:200" +
  "&filter=urlkey:.*bulletin_debt.*&collapse=urlkey&limit=25000&output=json";

// Filename → {year, month}. URL-decode first so the older `%20`-separated
// filenames (`...bg%2009%202015.pdf`) parse alongside the modern `+`/`-`
// form (`...bg+03-2024.pdf`). Non-digit runs separate the month and year.
const BULLETIN_RE = /bulletin_debt_bg[^\d]*(\d{1,2})[^\d]+(20\d{2})\.pdf$/i;

type CdxRow = [string, string, string, string, string, string, string];

interface Bulletin {
  year: number;
  month: number;
  url: string;
}

const enumerate = async (): Promise<{ urls: string[]; latest?: Bulletin }> => {
  const rows = await fetchJson<CdxRow[]>(`${CDX}?${BULLETIN_QUERY}`);
  if (!Array.isArray(rows) || rows.length < 2) return { urls: [] };

  const seen = new Set<string>();
  const urls: string[] = [];
  const dated: Bulletin[] = [];
  for (const row of rows.slice(1)) {
    const url = row[2].replace(/^http:\/\//, "https://");
    if (seen.has(url)) continue;
    seen.add(url);
    const fn = decodeURIComponent(url.split("/").pop() ?? "");
    // en-language bulletins carry the same debt figures — keep bg only so the
    // "latest month" label and the hash track one series, not two per month.
    if (!/bulletin_debt_bg/i.test(fn)) continue;
    urls.push(url);
    const m = BULLETIN_RE.exec(fn);
    if (!m) continue;
    const month = Number(m[1]);
    const year = Number(m[2]);
    if (month < 1 || month > 12) continue;
    dated.push({ year, month, url });
  }
  urls.sort();
  dated.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  return { urls, latest: dated[dated.length - 1] };
};

const formatLatest = (b: Bulletin | undefined): string =>
  b ? `${b.year}-${String(b.month).padStart(2, "0")}` : "—";

export const minfinEurobond: WatchSource = {
  id: "minfin_eurobond",
  label: "Minfin government-debt bulletins (Eurobond signal, via Wayback)",
  url: "https://www.minfin.bg/bg/statistics/20",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const { urls, latest } = await enumerate();
    if (urls.length === 0) {
      throw new Error("Wayback CDX returned no minfin debt bulletins");
    }
    // Hash the full URL set so a newly-crawled OLDER bulletin still flips the
    // fingerprint — a back-filled month can carry a Eurobond we never logged.
    const value = createHash("sha256").update(urls.join("\n")).digest("hex");
    return {
      value,
      detail: `${urls.length} debt bulletin(s) cached · latest ${formatLatest(latest)}`,
      meta: {
        count: urls.length,
        latestYear: latest?.year,
        latestMonth: latest?.month,
      },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev || prev.fingerprint === curr.value) return curr.detail;
    const prevCount = Number(prev.meta?.count ?? 0);
    const currCount = Number(curr.meta?.count ?? 0);
    const delta = currCount - prevCount;
    const prevLatest = `${prev.meta?.latestYear ?? "?"}-${String(prev.meta?.latestMonth ?? "?").padStart(2, "0")}`;
    const currLatest = `${curr.meta?.latestYear ?? "?"}-${String(curr.meta?.latestMonth ?? "?").padStart(2, "0")}`;
    if (delta > 0 && currLatest !== prevLatest) {
      return `${delta} new debt bulletin(s) · latest ${currLatest} (was ${prevLatest}) — check for a new Eurobond`;
    }
    if (delta > 0) {
      return `${delta} new debt bulletin(s) cached · latest ${currLatest} — check for a new Eurobond`;
    }
    return `debt-bulletin URL set churn (count ${currCount}, latest ${currLatest}) — Wayback re-cached one or more bulletins`;
  },
};
