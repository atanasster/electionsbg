// BG Wikipedia polls page. Fingerprint is the count of rows in the polls
// table — that's what /update-polls ingests and is robust to wiki edits that
// don't add a new poll (citation tweaks, prose changes around the table).
//
// URL matches the CYCLES array in scripts/polls/scrape_polls.ts. The latest
// election cycle accumulates polls between elections, so this watcher tracks
// the *current* cycle page (post-April-2026 election → 2026 page until the
// next is scheduled).

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";

const PAGE =
  "https://bg.wikipedia.org/wiki/Парламентарни_избори_в_България_(2026)";

const countPollRows = (html: string): number => {
  // BG Wiki polls table rows: each poll is a <tr> with a date cell and a
  // sequence of party columns. Heuristic — count <tr> inside any
  // wikitable with class containing "sortable" (the polls table is always
  // sortable). Tolerant to whitespace and attribute order.
  const tableMatch = html.match(
    /<table[^>]*class="[^"]*wikitable[^"]*sortable[^"]*"[\s\S]*?<\/table>/g,
  );
  if (!tableMatch) return 0;
  let total = 0;
  for (const t of tableMatch) {
    const rows = t.match(/<tr\b/g);
    if (rows) total += Math.max(0, rows.length - 1); // minus header row
  }
  return total;
};

export const wikiPolls: WatchSource = {
  id: "wiki_polls",
  label: "BG Wikipedia polls (2026 cycle)",
  url: PAGE,
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html) throw new Error("empty Wikipedia page");
    const rows = countPollRows(html);
    return {
      value: String(rows),
      detail: `${rows} poll table rows`,
      meta: { rows },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevRows = Number(prev.fingerprint) || 0;
    const currRows = Number(curr.value) || 0;
    const delta = currRows - prevRows;
    if (delta === 0) return curr.detail;
    return `${delta > 0 ? "+" : ""}${delta} rows since ${prev.lastChanged.slice(0, 10)} (${prevRows} → ${currRows})`;
  },
};
