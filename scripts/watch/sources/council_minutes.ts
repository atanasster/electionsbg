// Council resolutions + vote tallies watcher.
//
// Bulgaria has no central council-resolutions register (see
// project_council_votes_ingest memory; data.egov.bg only mandates the
// chl.45 "returned-decisions" register, not vote tallies). The ingest
// pipeline at scripts/council/ scrapes each município's own решения /
// протоколи index page; this watcher fingerprints those index pages so
// the daily report flips a single "Council resolutions index: N
// município(s) changed" line whenever any covered município publishes a
// new session.
//
// We DON'T fingerprint per município — chmi / mid-cycle replacements
// would generate too much noise in the daily report. Instead we compute
// one composite fingerprint across the wired municipalities and stash
// per-município counts in meta so describe() can name the changers.
//
// Cadence: daily. Municipalities sit roughly once a month, but agenda
// pages get re-saved more often (publication timestamps, attachment
// edits), so daily polling is the right cost/recency trade.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";

// Most municipal CMSes block the default watcher UA (electionsbg-watch/1.0)
// with a 401/403. Pass a real Safari UA on these probes — we're hitting
// public homepage HTML, no auth required, just bot heuristics.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "bg,en;q=0.7",
};

type MuniSourceLite = {
  name: string;
  tier: "A" | "B" | "C";
  indexUrl: string;
  phase1Defer?: boolean;
};

type SourcesFile = {
  munisByObshtina: Record<string, MuniSourceLite>;
};

/**
 * Heuristic per-município session-link count. We don't try to model the
 * 10+ different CMSes — instead we count anchors on the index page whose
 * href contains "reshen" OR "protokol" OR "prepis" (the universal
 * keywords across municipal CMSes), excluding navigation duplicates.
 * That's enough signal: a new sitting adds at least one such anchor.
 *
 * Two recipe forms have to be tolerated:
 *   1. HTML/server-rendered município site — count href="…protokol…"
 *      attributes.
 *   2. Gabrovo's Wayback CDX index URL — JSON output. Count raw URL
 *      substrings carrying "Protokol-zasedanie" / "protokol" instead.
 *
 * Falling through both paths gives a stable signal regardless of source
 * shape.
 */
const sessionCount = (body: string): number => {
  // HTML-style hrefs first.
  const anchors = body.match(/href="[^"]*(?:reshen|protokol|prepis)[^"]*"/giu);
  if (anchors && anchors.length > 0) return new Set(anchors).size;
  // Raw URL substrings (covers CDX JSON output).
  const urls = body.match(
    /https?:\/\/[^"'\s]*(?:Protokol-zasedanie|protokol|prepis|reshen)[^"'\s]*/giu,
  );
  if (urls && urls.length > 0) return new Set(urls).size;
  return 0;
};

const readSources = (): SourcesFile => {
  const p = join(process.cwd(), "data/council/sources.json");
  return JSON.parse(readFileSync(p, "utf-8")) as SourcesFile;
};

export const councilMinutes: WatchSource = {
  id: "council_minutes",
  label: "Council resolutions + vote tallies",
  // Composite source — the canonical URL is the local recipe file rather
  // than any one município site.
  url: "data/council/sources.json",
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const sources = readSources();
    const wired = Object.entries(sources.munisByObshtina)
      .filter(([, m]) => !m.phase1Defer)
      .sort(([a], [b]) => a.localeCompare(b));

    const counts: Record<string, number> = {};
    const errors: string[] = [];
    for (const [code, recipe] of wired) {
      const html = await fetchText(recipe.indexUrl, {
        headers: BROWSER_HEADERS,
      });
      if (html === null || html.length < 256) {
        errors.push(code);
        counts[code] = -1; // sentinel — surfaces in describe()
        continue;
      }
      counts[code] = sessionCount(html);
    }

    // Combined hash so any single município movement flips the source.
    const value = createHash("sha256")
      .update(
        Object.entries(counts)
          .map(([k, v]) => `${k}=${v}`)
          .join("|"),
      )
      .digest("hex");

    const totalSessions = Object.values(counts)
      .filter((v) => v >= 0)
      .reduce((a, b) => a + b, 0);

    return {
      value,
      detail:
        `${wired.length} município(s) wired, ${totalSessions} session-link(s) total` +
        (errors.length > 0 ? ` · ${errors.length} fetch error(s)` : ""),
      meta: { counts, errors },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevCounts =
      (prev.meta?.counts as Record<string, number> | undefined) ?? {};
    const currCounts =
      (curr.meta?.counts as Record<string, number> | undefined) ?? {};
    const moved: string[] = [];
    for (const code of Object.keys(currCounts).sort()) {
      const a = prevCounts[code] ?? 0;
      const b = currCounts[code];
      if (b > a) moved.push(`${code} +${b - a}`);
      else if (b < a && b >= 0) moved.push(`${code} -${a - b}`);
    }
    if (moved.length === 0) return curr.detail;
    return `${moved.length} município(s) changed: ${moved.join(", ")}`;
  },
};
