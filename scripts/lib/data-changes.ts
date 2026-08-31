// Shared library for the public data-changes audit log written to
// data/data-changes.json. The /process-watch-report orchestrator appends one
// entry per successful skill stamp; the SPA reads it via useDataChanges() to
// render the /data-changes page.
//
// Schema is a flat reverse-chronological list. The frontend groups by `date`
// for display — keeping the on-disk shape flat keeps appends O(1) and the
// JSON diff small.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { connectionUrl, isServingDatabase, redactUrl } from "../db/lib/pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_CHANGES_FILE = path.resolve(
  __dirname,
  "../../data/data-changes.json",
);

export type DataChangeLink = {
  to: string;
  labelKey: string;
};

export type DataChangeEntry = {
  // ISO UTC timestamp of when the ingest was stamped.
  timestamp: string;
  // YYYY-MM-DD in UTC, derived from `timestamp`. Denormalised so the SPA
  // doesn't have to recompute it for every render.
  date: string;
  // Skill name, e.g. "update-macro".
  skill: string;
  // Upstream label, e.g. "Eurostat macro (BG)". Optional.
  source?: string;
  // One-line summary from the orchestrator (counts, dates, file paths).
  summary: string;
  // Frontend links — `labelKey` is an i18n key under `data_changes_link_*`.
  links?: DataChangeLink[];
  // Stable identity of the DATA this row describes — the price day loaded, the
  // report period restated — never the wall clock. Set by self-reporting
  // ingests via `dedupeKey`; absent on rows written before it existed and on
  // the orchestrator's CLI appends. See `dedupeKey` for why it is on the entry
  // rather than recomputed: the two writers are separate processes, so the only
  // place the first can tell the second what it already reported is this file.
  key?: string;
};

export type DataChangesLog = {
  updatedAt: string;
  entries: DataChangeEntry[];
};

// Skill → links displayed on the data-changes page. Centralised here so the
// orchestrator doesn't have to hand-curate URLs per stamp call; the writer
// looks up by skill name. Kept loose (`labelKey` is just a string) so adding a
// new skill doesn't require a separate i18n keylist.
const SKILL_LINKS: Record<string, DataChangeLink[]> = {
  "update-rollcall": [
    { to: "/connections", labelKey: "data_changes_link_parliament" },
  ],
  "parliament-scrape": [
    { to: "/connections", labelKey: "data_changes_link_parliament" },
  ],
  "update-polls": [{ to: "/polls", labelKey: "data_changes_link_polls" }],
  "update-connections": [
    { to: "/connections", labelKey: "data_changes_link_connections" },
    { to: "/mp-assets", labelKey: "data_changes_link_assets" },
  ],
  "update-financing": [
    { to: "/financing", labelKey: "data_changes_link_financing" },
  ],
  "update-macro": [
    {
      to: "/demographics",
      labelKey: "data_changes_link_demographics",
    },
  ],
  "update-regional": [
    {
      to: "/demographics/regions",
      labelKey: "data_changes_link_regions_demographics",
    },
  ],
  "update-indicators": [
    {
      to: "/demographics/municipalities",
      labelKey: "data_changes_link_municipalities_demographics",
    },
  ],
  "update-officials": [
    { to: "/officials/assets", labelKey: "data_changes_link_officials" },
  ],
  // The news corpus is the one source served from a SEPARATE origin, so this
  // is the only cross-origin entry in the table.
  //
  // ⚠️ That is safe, and an earlier version of this comment claimed the
  // opposite — that react-router's <Link to={...}> would read an absolute URL
  // as a relative path and render a broken link. It does not: verified in the
  // installed react-router 7.17.0, `parseToInfo` matches ABSOLUTE_URL_REGEX,
  // marks the target `isExternal`, and `Link` emits a plain <a href> with the
  // absolute URL (chunk-6CSD65Y2.mjs:10493) rather than intercepting the
  // click. Check the installed version before adding another one, since this
  // is the only entry that depends on the behaviour.
  "save-news-articles": [
    { to: "https://news.electionsbg.com/", labelKey: "data_changes_link_news" },
  ],
};

export const linksForSkill = (skill: string): DataChangeLink[] =>
  SKILL_LINKS[skill] ?? [];

// Heuristic check on the orchestrator's one-line summary: does it describe an
// actual data refresh, or a no-op (bootstrap stamp, "unchanged tails",
// fetchedAt-only churn)? We don't want no-ops to clutter the public
// /data-changes page — readers care about substantive refreshes.
//
// The patterns mirror the phrases the tier-2 skills tend to use:
//   - "bootstrap: marker seeded, no run …" (parliament-scrape, rollcall, polls)
//   - "… all Eurostat tails unchanged … only fetchedAt diff" (update-macro)
//   - "… no data changes (timestamp-only diff reverted)" (update-regional)
//   - "otcheti: 15 years (2011-2025), unchanged …" (update-financing)
//
// Positive ingests like "first-run backfill: 1 indicator … 265 munis"
// (update-indicators) or "first real ingest … refreshed 70 entries, 2 MP
// isCurrent flips" (update-connections) do not trip these patterns even
// when they say "no new declarations" — that phrase qualifies one slice of
// the run, not the whole result.
export const isNoChangeSummary = (summary: string): boolean => {
  const s = summary.toLowerCase();
  if (s.startsWith("bootstrap:")) return true;
  if (/\bno data changes\b/.test(s)) return true;
  if (/only fetchedat diff/.test(s)) return true;
  if (/timestamp-only diff/.test(s)) return true;
  if (/\bno run\b/.test(s)) return true;
  if (/\bunchanged\b/.test(s)) return true;
  return false;
};

export const readDataChanges = (file = DATA_CHANGES_FILE): DataChangesLog => {
  if (!fs.existsSync(file)) {
    return { updatedAt: new Date(0).toISOString(), entries: [] };
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<DataChangesLog>;
    return {
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { updatedAt: new Date(0).toISOString(), entries: [] };
  }
};

const writeLog = (log: DataChangesLog, file = DATA_CHANGES_FILE): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(log, null, 2) + "\n");
};

export type AppendArgs = {
  skill: string;
  summary: string;
  source?: string;
  at?: string;
  links?: DataChangeLink[];
  // ⚠️ PREFER THIS OVER `dedupeSameDay`. A stable identity for the DATA the row
  // describes — the price day loaded, the report period restated — so a second
  // report of the SAME refresh replaces the first instead of adding a row.
  // Deduped across the whole log, deliberately without a time window.
  //
  // Keyed on the payload rather than on the wall clock because a self-reporting
  // ingest runs TWICE per publish cycle (once locally, once against Cloud SQL
  // via its `:cloud` twin), and those two runs can straddle UTC midnight —
  // measured 2026-08-31, local at 23:57:57Z and the cloud publish at 00:55:49Z,
  // which `dedupeSameDay` read as two different days and published as two days
  // of activity for one refresh. The same pair is in the committed log twice
  // more (2026-07-28 and 2026-08-28); the fix removed those.
  //
  // Three tempting keys that do NOT work, all measured against that log:
  //   - a wider dedupe WINDOW (24/48 h) swallows genuine consecutive-day
  //     refreshes, and prices publishes daily, so it would swallow most of them;
  //   - the wall-clock DATE is the bug above;
  //   - `summary` EQUALITY misses it whenever the two runs did different
  //     amounts of work for the same data day — the cloud database can be
  //     further behind than local, so it loads more archives and says
  //     "+2 daily archives" where local said "+1". That is not hypothetical:
  //     the 2026-07-28 pair in the log is exactly that shape.
  dedupeKey?: string;
  // Replace any existing same-(skill, UTC date) entry. The weaker fallback, for
  // callers whose row has no payload identity because it legitimately recurs on
  // every run (db:resolve:persons re-derives the whole person layer daily —
  // there is no "which data day" to key on). Carries the midnight-boundary
  // hazard described above, so it is safe only where a second same-run report
  // cannot happen: resolve_persons' `:cloud` twin passes `--no-stamp`.
  dedupeSameDay?: boolean;
  // Test seam. Defaults to the committed data/data-changes.json.
  file?: string;
};

/** A PUBLISH is not a data change, and a self-reporting ingest cannot tell the
 *  difference by itself: `prices:ingest:cloud` is literally `npm run prices`
 *  with DATABASE_URL pointed at the Cloud SQL proxy, so the same code path that
 *  ingested the day locally runs again to publish it and reports it a second
 *  time. The data changed once; the feed is reader-facing and must say so once.
 *
 *  Decided centrally rather than per-script so the next self-reporter inherits
 *  it: `update-agri` is PG-only, does not self-report yet, and its
 *  `db:load:agri:pg:cloud` is the same plain re-run — adding its
 *  `appendDataChange` call would otherwise reproduce this bug verbatim.
 *  (`resolve_persons` solves the same problem with a per-script `--no-stamp`
 *  flag on its `:cloud` twin. That works, but it is one edit per script AND one
 *  per npm script, i.e. exactly the re-fix this guard exists to avoid.)
 *
 *  Reads `isServingDatabase()` — the repo's one definition of "am I pointed at
 *  the database that serves production", an allowlist, and one that honours
 *  `pinLocalDatabase()`. Says so out loud rather than skipping quietly: a
 *  cloud DATABASE_URL left exported in a shell would otherwise silence a
 *  genuine local ingest's row with nothing to show for it. */
const suppressedAsPublish = (skill: string): boolean => {
  if (!isServingDatabase()) return false;
  console.log(
    `· data-changes: NOT appending ${skill} — this process targets the serving ` +
      `database (${redactUrl(connectionUrl())}), so it is a publish, not a data ` +
      `change. The ingest that produced this data already reported it.`,
  );
  return true;
};

/** Returns the appended entry, or null when the append was suppressed as a
 *  publish. Only the CLI reads the result; the self-reporting ingests ignore it. */
export const appendDataChange = (args: AppendArgs): DataChangeEntry | null => {
  if (suppressedAsPublish(args.skill)) return null;

  const timestamp = args.at ?? new Date().toISOString();
  const date = timestamp.slice(0, 10);
  const entry: DataChangeEntry = {
    timestamp,
    date,
    skill: args.skill,
    summary: args.summary,
  };
  if (args.source) entry.source = args.source;
  const links = args.links ?? linksForSkill(args.skill);
  if (links.length > 0) entry.links = links;
  if (args.dedupeKey) entry.key = args.dedupeKey;

  const log = readDataChanges(args.file);
  if (args.dedupeKey)
    // Key identity subsumes the date, so this deliberately does NOT also filter
    // by date: two runs reporting the same data day collapse however far apart
    // they are, and two DIFFERENT data days reported on one calendar day both
    // survive (`dedupeSameDay` would have dropped the earlier one — a real
    // refresh lost).
    log.entries = log.entries.filter(
      (e) => !(e.skill === args.skill && e.key === args.dedupeKey),
    );
  else if (args.dedupeSameDay)
    log.entries = log.entries.filter(
      (e) => !(e.skill === args.skill && e.date === date),
    );
  log.entries = [entry, ...log.entries];
  log.updatedAt = timestamp;
  writeLog(log, args.file);
  return entry;
};
