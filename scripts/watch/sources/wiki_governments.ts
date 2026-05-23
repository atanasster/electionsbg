// BG Wikipedia governments-list page. data/governments.json is hand-maintained
// from this page (per the README: "cabinets from Wikipedia"), so when the wiki
// list flips — new cabinet formed, incumbent's end date filled in, end reason
// edited on the most recent entry — somebody needs to hand-edit
// data/governments.json. This watcher surfaces that need.
//
// Fingerprint strategy: row count across all wikitables on the page PLUS a
// SHA-256 short hash of the last ~3kB of HTML content (the tail of the page,
// where the most-recent cabinets live). Two signals because:
//   - Row count alone misses end-date / coalition fixes on the current row.
//   - Tail-hash alone is too noisy if Wikipedia adds an unrelated footnote.
// Either changing flips the fingerprint; both together gives a clear "what
// kind of change" signal in the describe() output.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const PAGE =
  "https://bg.wikipedia.org/wiki/Списък_на_правителствата_на_България";

// Count rows across every wikitable on the page. The article spans 1879 →
// present in several sectional tables (княжество / царство / нар. република /
// република); summing across tables means a new modern cabinet bumps the
// count by 1 regardless of where the editor inserts the row.
const countCabinetRows = (html: string): number => {
  const tables = html.match(
    /<table[^>]*class="[^"]*wikitable[^"]*"[\s\S]*?<\/table>/g,
  );
  if (!tables) return 0;
  let total = 0;
  for (const t of tables) {
    const rows = t.match(/<tr\b/g);
    if (rows) total += Math.max(0, rows.length - 1); // minus header row
  }
  return total;
};

// Stable-ish "what's at the bottom of the page" hash. Strips dynamic noise
// (script blocks, page-revision metadata in the parser-output footer) so an
// unrelated cache-buster doesn't trigger a phantom change.
const tailHash = (html: string): string => {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<link[^>]*>/g, "")
    .replace(/data-mw-[^=]+="[^"]*"/g, "");
  const tail = stripped.slice(-4000);
  return sha256Short(tail);
};

export const wikiGovernments: WatchSource = {
  id: "wiki_governments",
  label: "BG Wikipedia governments list",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html) throw new Error("empty Wikipedia page");
    const rows = countCabinetRows(html);
    const tail = tailHash(html);
    return {
      value: `${rows}|${tail}`,
      detail: `${rows} cabinets · tail ${tail}`,
      meta: { rows, tail },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevRows = typeof prev.meta?.rows === "number" ? prev.meta.rows : NaN;
    const currRows = typeof curr.meta?.rows === "number" ? curr.meta.rows : NaN;
    const rowDelta = currRows - prevRows;
    const since = prev.lastChanged.slice(0, 10);
    if (Number.isFinite(rowDelta) && rowDelta !== 0) {
      return `${rowDelta > 0 ? "+" : ""}${rowDelta} cabinet row(s) since ${since} (${prevRows} → ${currRows}) — likely new cabinet formed`;
    }
    return `tail of page edited since ${since} — likely end-date or coalition update on the latest cabinet`;
  },
};
