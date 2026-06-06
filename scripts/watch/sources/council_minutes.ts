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
// KNOWN GAPS (acceptable while the fleet has 15+ other publishers):
//   - SOF (Sofia): Liferay SPA. The meetings page server-renders only a
//     shell — the session list hydrates client-side. Count stays at 0
//     every day. SOF still gets re-ingested whenever ANY other muni
//     flips the composite fingerprint (which is nearly daily given the
//     fleet's size).
//   - VTR01 (Велико Търново): year-routing landing page at /bg/resheniya/
//     only links to per-year sub-pages. We probe the current year via
//     {YYYY} substitution; before the first session of each new year
//     lands, that URL 404s and we fall back to the parent page (5
//     stable anchors). Same composite-fingerprint safety net as SOF.
//
// Cadence: daily. Municipalities sit roughly once a month, but agenda
// pages get re-saved more often (publication timestamps, attachment
// edits), so daily polling is the right cost/recency trade.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";
import { readState } from "../state";

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
  /** Optional override URL for the watcher fingerprint. Use when the
   *  canonical indexUrl is a JS-rendered shell (SOF Liferay SPA) or a
   *  year-routing landing page that itself never changes (VTR01's
   *  /bg/resheniya/ which just links to per-year sub-pages). Without
   *  this override the fingerprint would stay at 0/low forever and the
   *  daily report would never flip for new sittings on those munis. */
  watcherUrl?: string;
  phase1Defer?: boolean;
};

type SourcesFile = {
  munisByObshtina: Record<string, MuniSourceLite>;
};

/**
 * Heuristic per-município session-link count. We don't try to model the
 * 10+ different CMSes — instead we count anchors whose href contains a
 * council keyword in ANY of three encoding forms, excluding navigation
 * duplicates. That's enough signal: a new sitting adds at least one such
 * anchor.
 *
 * The three forms a council slug can take on a Bulgarian municipal CMS:
 *
 *   1. Latin transliteration ("protokol", "reshen", "prepis") — Sofia,
 *      Pleven, Sliven, V. Tarnovo, Razgrad, Burgas, Sofia-style CMSes
 *      where the path is romanised by the publisher.
 *
 *   2. Percent-encoded Cyrillic — WordPress + Joomla emit Cyrillic slugs
 *      pre-encoded into the HTML's href attribute, e.g.
 *      "%d0%bf%d1%80%d0%be%d1%82%d0%be%d0%ba%d0%be%d0%bb" = "протокол".
 *      Перник, Русе, Plovdiv, Dimitrovgrad fall here.
 *
 *   3. Literal Cyrillic — the modern Atom/feed renderers, Varna's WP,
 *      and Dimitrovgrad's anchor texts use the raw Cyrillic glyphs.
 *
 * Two recipe URL shapes also need tolerating:
 *   - HTML responses (the majority) → href= scan above.
 *   - Wayback CDX index URLs (Gabrovo / Kazanlak / Хасково / Добрич) →
 *     JSON output. Count raw URL substrings carrying any of the same
 *     three forms.
 *
 * Falling through every path gives a stable signal regardless of source
 * shape and avoids the silent-zero trap where a municipality publishes
 * Cyrillic slugs the ASCII regex couldn't see — the fingerprint then
 * stays at 0 even after new sessions land.
 */
const KEYWORD_LATIN = "(?:reshen|protokol|prepis|Protokol-zasedanie)";
// Percent-encoded Cyrillic for "решен" (д1 8 0 / е) and "протокол":
//   протокол → %d0%bf%d1%80%d0%be%d1%82%d0%be%d0%ba%d0%be%d0%bb
//   решен    → %d1%80%d0%b5%d1%88%d0%b5%d0%bd
//   препис   → %d0%bf%d1%80%d0%b5%d0%bf%d0%b8%d1%81
const KEYWORD_PCT =
  "(?:%d0%bf%d1%80%d0%be%d1%82%d0%be%d0%ba%d0%be%d0%bb|%d1%80%d0%b5%d1%88%d0%b5%d0%bd|%d0%bf%d1%80%d0%b5%d0%bf%d0%b8%d1%81)";
const KEYWORD_CYRILLIC = "(?:протокол|решен|препис)";
// Burgas custom Drupal exposes each sitting as /node/<id> with no keyword
// in the href. Sliven's opaque-hash file URLs (/uploads/<HEX32>) and any
// .pdf/.docx attachment URL likewise carry no keyword but flip whenever a
// new sitting is published. We add these as SECONDARY signals — counted
// together with the keyword hits so the fingerprint stays sensitive even
// on CMSes that don't expose keyword-bearing anchors.
const KEYWORD_ALL = `(?:${KEYWORD_LATIN}|${KEYWORD_PCT}|${KEYWORD_CYRILLIC})`;
const ATTACHMENT_PATTERN =
  "(?:\\.docx?|\\.pdf|/node/\\d+|/uploads/[a-f0-9]{16,})";

const sessionCount = (body: string): number => {
  const all = new Set<string>();
  // Primary: keyword-bearing hrefs (HTML responses) AND raw URL substrings
  // (covers Wayback CDX JSON outputs).
  const hrefRe = new RegExp(`href="[^"]*${KEYWORD_ALL}[^"]*"`, "giu");
  for (const a of body.match(hrefRe) ?? []) all.add(a);
  if (all.size === 0) {
    const urlRe = new RegExp(
      `https?://[^"'\\s]*${KEYWORD_ALL}[^"'\\s]*`,
      "giu",
    );
    for (const u of body.match(urlRe) ?? []) all.add(u);
  }
  // Secondary: attachment-style hrefs (PDF/DOCX/DOC, Drupal /node/<id>,
  // opaque /uploads/<hex> Sliven slugs). These don't carry keywords but
  // still appear once per sitting and so move the fingerprint when a new
  // session lands. Counted together so we get the union, not just the
  // fallback — a Wordpress site with 50 keyword hrefs AND 50 PDF
  // attachments still gets ~50 distinct sittings reflected here.
  const attachRe = new RegExp(`href="[^"]*${ATTACHMENT_PATTERN}[^"]*"`, "giu");
  for (const a of body.match(attachRe) ?? []) all.add(a);
  return all.size;
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
    // Resolve {YYYY} → current year so recipes with a year-routing
    // landing page (V. Tarnovo) auto-roll on January 1.
    const currentYear = new Date().getUTCFullYear().toString();
    for (const [code, recipe] of wired) {
      const probeUrl = (recipe.watcherUrl ?? recipe.indexUrl).replace(
        /\{YYYY\}/g,
        currentYear,
      );
      // Two-tier fetch: try the (year-resolved) watcherUrl first, fall
      // back to the canonical indexUrl on any failure. This handles
      // (a) early-year cases where /bg/resheniya-{YYYY}-godina/ doesn't
      // exist yet (V. Tarnovo creates the year page on the first
      // session), (b) transient 5xx, (c) bot-block UA mismatches. The
      // wrapping try/catch keeps a single muni's failure from aborting
      // the whole fingerprint sweep.
      let html: string | null = null;
      try {
        html = await fetchText(probeUrl, {
          headers: BROWSER_HEADERS,
          allow404: true,
        });
      } catch {
        html = null;
      }
      if (
        (html === null || html.length < 256) &&
        probeUrl !== recipe.indexUrl
      ) {
        try {
          html = await fetchText(recipe.indexUrl, {
            headers: BROWSER_HEADERS,
            allow404: true,
          });
        } catch {
          html = null;
        }
      }
      if (html === null || html.length < 256) {
        errors.push(code);
        counts[code] = -1; // sentinel — surfaces in describe()
        continue;
      }
      counts[code] = sessionCount(html);
    }

    // Monotonic high-water marks per município. The raw session-link count
    // is twitchy: some municipal CMSes (notably Varna, whose index inlines
    // every decision PDF *plus* every appendix PDF — 300+ hrefs) serve an
    // occasional partial render that drops the count by dozens, then recover
    // on the next fetch. Hashing the raw counts made BOTH the dip and the
    // recovery flip the composite fingerprint, re-queueing update-council-
    // minutes for days on end even though the ingest found 0 new protocols
    // (VAR01 went 325→334→245→334 across 2026-06-04..06; the −89/+89 was a
    // single bad fetch). We instead hash the high-water mark: only a genuine
    // NEW HIGH (a new sitting pushing the link count past its prior peak)
    // flips the source. Transient dips and transient fetch errors (which
    // would otherwise toggle the −1 sentinel) are absorbed — the existing
    // composite safety-net (every muni gets re-ingested whenever ANY muni
    // flips, and each muni's own date watermark dedupes) still catches a
    // genuinely-new sitting even on the rare run where a muni is mid-dip.
    const prev = readState("council_minutes");
    const prevMax: Record<string, number> =
      (prev?.meta?.maxCounts as Record<string, number> | undefined) ??
      // Backward-compat seed (first run after this change): use last raw
      // counts as the initial high-water marks, clamping the −1 error
      // sentinel to 0 so a recovering muni flips exactly once.
      Object.fromEntries(
        Object.entries(
          (prev?.meta?.counts as Record<string, number> | undefined) ?? {},
        ).map(([k, v]) => [k, v >= 0 ? v : 0]),
      );

    const maxCounts: Record<string, number> = {};
    for (const [code] of wired) {
      const raw = counts[code];
      const prior = prevMax[code] ?? 0;
      // Errors (-1) never lower the mark; a real count only ever raises it.
      maxCounts[code] = raw >= 0 ? Math.max(prior, raw) : prior;
    }

    // Guaranteed periodic sweep for the count-BLIND municipalities. VTR01 and
    // SOF expose no usable index count (their landing pages are a year-routing
    // shell / a Liferay SPA — counts pin at ~5 / 0 and never move when a new
    // sitting lands; see KNOWN GAPS above). Historically they were re-ingested
    // only as a *side effect* of some noisier muni flipping the composite —
    // e.g. on 2026-06-06 VTR01's 47 new resolutions were picked up purely
    // because VAR01's partial-render wobble flipped the source. Now that the
    // high-water-mark hash (above) correctly suppresses those wobbles, we'd
    // lose that incidental trigger. So fold a coarse N-day epoch into the hash:
    // the composite flips at least once every HEARTBEAT_DAYS regardless of
    // fleet activity, bounding blind-muni staleness — without the day-after-day
    // churn that the raw-count hash produced. A genuine new high still flips it
    // immediately for the 14 count-visible munis; the heartbeat only fires
    // standalone during a stretch where nothing in the fleet moved.
    const HEARTBEAT_DAYS = 3;
    const heartbeatEpoch = Math.floor(
      Date.now() / (HEARTBEAT_DAYS * 24 * 60 * 60 * 1000),
    );

    // Combined hash over the high-water marks (so any município's new peak = a
    // new sitting flips the source, while dips/errors don't) plus the heartbeat
    // epoch (so the blind munis still get a bounded periodic sweep).
    const value = createHash("sha256")
      .update(
        Object.entries(maxCounts)
          .map(([k, v]) => `${k}=${v}`)
          .join("|") + `|__heartbeat=${heartbeatEpoch}`,
      )
      .digest("hex");

    const totalSessions = Object.values(maxCounts).reduce((a, b) => a + b, 0);

    return {
      value,
      detail:
        `${wired.length} município(s) wired, ${totalSessions} session-link(s) total` +
        (errors.length > 0 ? ` · ${errors.length} fetch error(s)` : ""),
      meta: { counts, maxCounts, errors, heartbeatEpoch },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    // Compare the high-water marks — that's what the fingerprint hashes, so
    // it's what actually flipped. (Fall back to raw counts for a state file
    // written before maxCounts existed.) Because the marks are monotonic,
    // the only deltas reported here are growth (a muni's new session peak).
    const prevCounts =
      (prev.meta?.maxCounts as Record<string, number> | undefined) ??
      (prev.meta?.counts as Record<string, number> | undefined) ??
      {};
    const currCounts =
      (curr.meta?.maxCounts as Record<string, number> | undefined) ??
      (curr.meta?.counts as Record<string, number> | undefined) ??
      {};
    const moved: string[] = [];
    for (const code of Object.keys(currCounts).sort()) {
      const a = prevCounts[code] ?? 0;
      const b = currCounts[code];
      if (b > a) moved.push(`${code} +${b - a}`);
      else if (b < a && b >= 0) moved.push(`${code} -${a - b}`);
    }
    // No high-water-mark moved but the source still flipped → the N-day
    // heartbeat epoch rolled over (the bounded safety sweep for the
    // count-blind munis VTR01/SOF). Say so rather than dumping the raw detail.
    if (moved.length === 0)
      return `periodic safety re-check (no count change) · ${curr.detail}`;
    return `${moved.length} município(s) changed: ${moved.join(", ")}`;
  },
};
