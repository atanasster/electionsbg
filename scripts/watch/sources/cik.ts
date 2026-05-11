// CIK (Централна избирателна комисия) news/decisions index. CIK publishes
// decisions and announcements at /bg/news; during election cycles this is
// hourly, between cycles weekly. We fingerprint the HTML of the index and
// extract the latest decision number/date if present.
//
// CIK uses Cloudflare on results.cik.bg but the public site cik.bg is open.

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
    if (!html) throw new Error("empty CIK page");
    // Heuristic: pull all decision/announcement titles (links inside the news
    // list) and hash them. Robust to layout chrome changes.
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
