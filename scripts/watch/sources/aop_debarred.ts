// АОП debarred-suppliers register (www2.aop.bg, "Стопански субекти с
// нарушения"). Tiny upstream — typically 1-5 active entries at any time,
// updated when КЗК rulings become final (a few times per year). The
// processed JSON is at data/procurement/debarred.json; this watcher tells
// the orchestrator when to re-scrape.
//
// Fingerprint is the count of rows in the single <table> on the page, plus a
// hash of the row text — robust to chrome changes (header reordering, CSS
// class renames) and only flips when an entry is added or its срок is
// updated. Cadence is monthly because new entries land at most a few times
// per year and the upstream is small.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const PAGE =
  "https://www2.aop.bg/stopanski-subekti/stopanski-subekti-s-narusheniya/";

// www2.aop.bg returns 403 to the default watcher User-Agent and accepts a
// browser UA — match what scripts/procurement/debarred.ts uses so a watch
// "changed" signal lines up 1:1 with what the ingest will see.
const BROWSER_UA =
  "Mozilla/5.0 (compatible; electionsbg-procurement/1.0; +https://electionsbg.com)";

// Pull <td> cell text out of every <tr>. The page has exactly one data table
// inside the article body; extracting cells is more stable than counting
// <tr> because the surrounding chrome occasionally adds informational rows.
const extractRows = (html: string): string[] => {
  const out: string[] = [];
  const tableMatch = html.match(/<table\b[\s\S]*?<\/table>/i);
  if (!tableMatch) return out;
  const rowMatches = tableMatch[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi);
  for (const r of rowMatches) {
    const cellTexts = Array.from(r[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi))
      .map((m) =>
        m[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((s) => s.length > 0);
    if (cellTexts.length === 0) continue;
    out.push(cellTexts.join(" | "));
  }
  return out;
};

export const aopDebarred: WatchSource = {
  id: "aop_debarred",
  label: "АОП debarred-suppliers register",
  url: PAGE,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE, {
      headers: { "User-Agent": BROWSER_UA },
    });
    if (!html) throw new Error("empty АОП debarred page");
    const rows = extractRows(html);
    if (rows.length === 0) {
      // Genuine "list emptied" is possible — every active entry could expire
      // simultaneously. Distinguish from a markup-change false-negative by
      // surfacing the row count in the detail; the orchestrator can compare
      // against the prior fingerprint and notice.
      const value = "0";
      return {
        value,
        detail: `0 rows on debarred page (hash ${value})`,
        meta: { count: 0 },
      };
    }
    const value = sha256Short(rows.join("\n"));
    return {
      value,
      detail: `${rows.length} entries on debarred register, hash ${value}`,
      meta: { count: rows.length, sample: rows.slice(0, 3) },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevCount = (prev.meta?.count as number | undefined) ?? 0;
    const currCount = (curr.meta?.count as number | undefined) ?? 0;
    const delta = currCount - prevCount;
    if (delta === 0)
      return `${currCount} entries (content changed, no net add/remove)`;
    return `${delta > 0 ? "+" : ""}${delta} entries on debarred register (${prevCount} → ${currCount})`;
  },
};
