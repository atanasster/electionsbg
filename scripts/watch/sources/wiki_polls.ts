// BG Wikipedia polling tables — cross-check ONLY, never an ingest input.
//
// ⚠️ This source used to be what /update-polls ingested from. It is not any
// more: Wikipedia's polling tables have measured defects (renormalised values
// transcribed as raw, small parties dropped, an outright mislabel — see
// scrape_polls.ts's header) and the corpus is now sourced from each agency's
// own publication. This watcher exists so a flip still queues /update-polls,
// which then runs `polls:crosscheck` (a report, never a write) to say whether
// Wikipedia found a poll the agency watchers missed, or disagrees with a
// locked value. See docs/plans/polls-agency-watchers-v1.md (decision 1, T0.3).
//
// The label PREFIX "BG Wikipedia polls" is what `process-watch-report`
// matches on — kept stable across this relabel for that reason.
//
// Tracks BOTH the parliamentary cycle page (the one CYCLES in scrape_polls.ts
// names) and the presidential cycle page, as one source: a presidential poll
// is exactly as much "a poll the agency watchers might have missed" as a
// parliamentary one, and it costs one extra request to fold in.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";

interface WikiPollsMeta {
  parlRows: number;
  presRows: number;
}

const PARLIAMENTARY_PAGE =
  "https://bg.wikipedia.org/wiki/Парламентарни_избори_в_България_(2026)";
const PRESIDENTIAL_PAGE =
  "https://bg.wikipedia.org/wiki/Президентски_избори_в_България_(2026)";

const countPollRows = (html: string): number => {
  // BG Wiki polls table rows: each poll is a <tr> with a date cell and a
  // sequence of party columns. Heuristic — count <tr> inside any
  // wikitable with class containing "sortable" (the polls table is always
  // sortable, on both the parliamentary and the presidential page — verified
  // 2026-09-05). Tolerant to whitespace and attribute order.
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

// `fetchText` (no `allow404`) THROWS on a real HTTP/network failure — it
// returns null only on a 404 with `allow404` set, which this source never
// passes. So the realistic failure mode is a rejection from inside
// `fetchText` itself, and `Promise.all` would otherwise surface that raw
// error ("HTTP 500") with no indication of WHICH page failed. This wraps each
// fetch so every failure — a throw or an unexpected empty body — names its
// page.
const fetchPage = async (url: string, label: string): Promise<string> => {
  let html: string | null;
  try {
    html = await fetchText(url);
  } catch (e) {
    throw new Error(
      `${label} Wikipedia page: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!html) throw new Error(`empty Wikipedia page (${label})`);
  return html;
};

export const wikiPolls: WatchSource = {
  id: "wiki_polls",
  label: "BG Wikipedia polls (cross-check only)",
  url: PARLIAMENTARY_PAGE,
  cadence: "daily",
  // Every poll on either page is filed against a fieldwork window measured in
  // days, so a daily probe samples comfortably inside the cadence invariant.
  publishes: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const [parlHtml, presHtml] = await Promise.all([
      fetchPage(PARLIAMENTARY_PAGE, "parliamentary"),
      fetchPage(PRESIDENTIAL_PAGE, "presidential"),
    ]);
    const parlRows = countPollRows(parlHtml);
    const presRows = countPollRows(presHtml);
    const meta: WikiPollsMeta = { parlRows, presRows };
    return {
      value: `${parlRows}:${presRows}`,
      detail: `${parlRows} parliamentary + ${presRows} presidential poll table rows`,
      meta: { ...meta },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevMeta = (prev.meta ?? {}) as Partial<WikiPollsMeta>;
    // `Fingerprint.meta` is declared as `Record<string, unknown>`, so this is
    // Partial too even though `fingerprint()` above always fills both fields
    // within one process — TS cannot see across that boundary, and the `?? 0`
    // fallbacks below keep the read safe regardless (mon_ri_register.ts's
    // convention).
    const currMeta = (curr.meta ?? {}) as Partial<WikiPollsMeta>;
    // "No prior per-page counts" is not "no change" — the live state file
    // predates this two-page shape and carries the old `{ rows: 113 }` meta,
    // so `?? 0` would fabricate "parliamentary +113 rows (0 → 113)" on the
    // very first run after this ships. Fall back to the plain detail line
    // instead; the NEXT run (once the state file holds the new shape) computes
    // real per-page deltas. Same guard as mon_ri_register.ts's migration note.
    if (prevMeta.parlRows == null || prevMeta.presRows == null)
      return curr.detail;
    const prevParl = prevMeta.parlRows;
    const prevPres = prevMeta.presRows;
    const deltaParl = (currMeta.parlRows ?? 0) - prevParl;
    const deltaPres = (currMeta.presRows ?? 0) - prevPres;
    const since = prev.lastChanged
      ? ` since ${prev.lastChanged.slice(0, 10)}`
      : "";
    const parts: string[] = [];
    if (deltaParl !== 0)
      parts.push(
        `parliamentary ${deltaParl > 0 ? "+" : ""}${deltaParl} rows (${prevParl} → ${currMeta.parlRows})`,
      );
    if (deltaPres !== 0)
      parts.push(
        `presidential ${deltaPres > 0 ? "+" : ""}${deltaPres} rows (${prevPres} → ${currMeta.presRows})`,
      );
    if (parts.length === 0) return curr.detail;
    return `${parts.join(", ")}${since}`;
  },
};
