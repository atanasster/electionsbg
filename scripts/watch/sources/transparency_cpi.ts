// Transparency International CPI — Bulgaria country page.
//
// CPI is published once a year (typically the second week of February: the
// 2025 index dropped on 10 Feb 2026). Cadence is "monthly" — cheap to probe
// and guarantees we notice within a month of release.
//
// Fingerprint is `${year}:${score}` extracted from two sentinels on the page:
//
//   "Score changes 2012 - 2025"                          → latest year
//   "score of 40 this year, with a change of -3 since
//    last year, meaning it ranks 84 out of 182 countries" → score + change + rank
//
// TI templates both blocks from the same dataset, so they always flip together.
// The TI_CPI[] array in scripts/macro/fetch_eurostat.ts is hand-curated; a flip
// here means "paste { year: N, value: S } into that array, then re-run macro".

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";

const PAGE = "https://www.transparency.org/en/countries/bulgaria";

interface CpiSnapshot {
  year: number;
  score: number;
  change: number;
  rank: number;
  totalCountries: number;
}

interface ParseResult {
  year: number;
  snapshot: CpiSnapshot | null;
}

const parseCpi = (html: string): ParseResult | null => {
  const yearMatch = html.match(/Score\s+changes\s+\d{4}\s*-\s*(\d{4})/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);

  const m = html.match(
    /score of (\d+) this year, with a change of (-?\d+) since last year, meaning it ranks (\d+) out of (\d+) countries/,
  );
  if (!m) return { year, snapshot: null };
  return {
    year,
    snapshot: {
      year,
      score: Number(m[1]),
      change: Number(m[2]),
      rank: Number(m[3]),
      totalCountries: Number(m[4]),
    },
  };
};

export const transparencyCpi: WatchSource = {
  id: "transparency_cpi",
  label: "Transparency International CPI (Bulgaria)",
  url: PAGE,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    // TI's CDN blocks the watcher UA (bot-detection); a real browser UA works.
    const html = await fetchText(PAGE, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!html) throw new Error("empty TI Bulgaria page");
    const parsed = parseCpi(html);
    if (!parsed) {
      throw new Error(
        "could not locate 'Score changes YYYY - YYYY' heading on page",
      );
    }
    const { year, snapshot } = parsed;
    if (!snapshot) {
      return {
        value: `year=${year}`,
        detail: `latest year ${year} (score sentence missing — TI page chrome may have changed)`,
        meta: { year },
      };
    }
    const sign = snapshot.change >= 0 ? "+" : "";
    return {
      value: `${snapshot.year}:${snapshot.score}`,
      detail: `${snapshot.year} CPI = ${snapshot.score}/100, rank ${snapshot.rank}/${snapshot.totalCountries} (${sign}${snapshot.change} y/y)`,
      meta: { ...snapshot },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    if (prev.fingerprint === curr.value) return curr.detail;
    return `${curr.detail} — was ${prev.detail}`;
  },
};
