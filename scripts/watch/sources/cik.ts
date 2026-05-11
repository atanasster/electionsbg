// CIK (Централна избирателна комисия) news/decisions index.
//
// DISABLED in v1 — cik.bg sits behind Cloudflare's anti-bot challenge and
// returns HTTP 403 for plain curl/fetch (including from CI). The
// parliament-scrape SKILL.md already documents this constraint for the
// related results.cik.bg domain.
//
// To re-enable: swap fetchText for a Playwright-based fetch (Playwright is
// already a devDependency for the test suite), or discover an RSS/JSON
// endpoint that bypasses the challenge. Until then this source is omitted
// from SOURCES in ./index.ts — kept in the file so the toggle is one-line.

import type { WatchSource, Fingerprint } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const PAGE = "https://www.cik.bg/bg/news";

export const cik: WatchSource = {
  id: "cik",
  label: "CIK news & decisions",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html)
      throw new Error("Cloudflare challenge on cik.bg — needs Playwright");
    const titles = Array.from(
      html.matchAll(
        /<a[^>]*href="[^"]*\/bg\/news\/[^"]+"[^>]*>([^<]{4,200})<\/a>/g,
      ),
    )
      .map((m) => m[1].trim())
      .filter((t) => t.length > 0)
      .slice(0, 50);
    const value = sha256Short(titles.join("\n"));
    return {
      value,
      detail: `${titles.length} news items, latest: ${titles[0]?.slice(0, 80) ?? "—"}`,
      meta: { titles: titles.slice(0, 10) },
    };
  },
};
