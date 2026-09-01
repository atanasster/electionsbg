// The home page's „what changed" feed, as ONE small committed JSON.
//
//   npx tsx scripts/db/gen_home/feed.ts
//
// ===========================================================================
// ⚠️ THE WINDOW ENDS AT `computedAt`, WHICH IS THE MAXIMUM SOURCE VINTAGE — NEVER `now`.
//
// A 30-day window anchored on the calendar slides every day with no source change: rows age
// out, the ranking's recency term moves, and the artifact is different on every run. Three
// things break at once. `db:check-generated` compares committed bytes against the live
// bucket object and would report permanent drift, so it stops being a signal. The
// byte-identical rebuild the plan requires becomes impossible. And a stalled pipeline looks
// fresh — the window keeps advancing while the newest event stays put, which is the one
// failure a change feed must never hide.
//
// Anchored on the sources, the window means „the last 30 days OF DATA WE HAVE", which is
// also the honest sentence when a source is behind. The RENDERER knows the clock and is
// where staleness surfaces.
//
// ⚠️ AND NO STORED FIELD IS A FUNCTION OF `now`. `deadlineAt` is a fact; „closes in 3 days"
// is a rendering. This is the `open_calls` (142) rule one layer up — that table stores no
// status because one frozen at crawl time shows an expired call as open all weekend after a
// Friday failure. `findNowRelativeFields` refuses the shape before the file is written.
// ===========================================================================
//
// Plan: docs/plans/home-dashboard-implementation-v1.md §6.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOME_DATE_BASES,
  HOME_EVENT_CATEGORIES,
  findNowRelativeFields,
  type HomeEventCategory,
  type HomeEventV1,
  type HomeFeedV1,
} from "../../../src/data/home/homeTypes";
import { ADAPTERS, type AdapterContext } from "./events/adapters";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const OUT = path.join(ROOT, "data/home/feed.json");

/** §6.6's budget. 40 rows is well inside 64 KiB and is more than any surface renders — the
 *  home page takes six — so the tail exists for a later „see all" rather than for the hub. */
export const MAX_EVENTS = 40;
export const WINDOW_DAYS = 30;
/** The home page renders this many. The artifact is already ranked, so the browser takes a
 *  prefix and never re-ranks. */
export const RENDERED = 6;
/** No more than this many of one category in the rendered prefix — or one busy source (the
 *  council shards are thousands of rows) becomes the whole feed. */
export const MAX_PER_CATEGORY = 2;
/** …and at least this many distinct categories in it, when the eligible rows allow. */
export const MIN_CATEGORIES = 3;

const readJson = <T>(rel: string): T | null => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
};

/** The date a row is PRESENTED under — the one its own `dateBasis` names.
 *
 *  ⚠️ Not „the newest date on the row". A row carrying both an `effectiveAt` and a
 *  `deadlineAt` is dated by whichever its basis declares, and ranking on the other would
 *  order the feed by a date it never shows. */
export const displayDate = (e: HomeEventV1): string => {
  switch (e.dateBasis) {
    case "occurred":
      return e.occurredAt ?? e.firstSeenAt;
    case "published":
      return e.publishedAt ?? e.firstSeenAt;
    case "effective":
      return e.effectiveAt ?? e.firstSeenAt;
    case "deadline":
      return e.deadlineAt ?? e.firstSeenAt;
    case "first_seen":
      return e.firstSeenAt;
  }
};

/**
 * The deterministic rank. Recency on the DECLARED basis, plus what the row is worth and
 * whether a reader can act on it, minus the two penalties.
 *
 * ⚠️ Recency is measured against `computedAt`, not against the clock — same reason as the
 * window. A rank that moves with the calendar makes two rebuilds of one corpus differ.
 */
export const rankOf = (e: HomeEventV1, computedAt: string): number => {
  const ageDays =
    (Date.parse(computedAt) - Date.parse(displayDate(e))) / 86_400_000;
  const recency = Math.max(0, 1 - Math.max(0, ageDays) / WINDOW_DAYS);
  const national = e.scope.level === "national" ? 0.15 : 0;
  const backfillPenalty = e.backfill ? 0.4 : 0;
  const coveragePenalty = e.coverage.complete ? 0 : 0.1;
  return (
    recency * 1.5 +
    e.materiality +
    e.actionability * 0.75 +
    national -
    backfillPenalty -
    coveragePenalty
  );
};

/** Rank desc, then `id` — a STABLE tie-break, so two rebuilds of the same corpus cannot
 *  order two equally-scored rows differently. */
export const orderEvents = (
  events: HomeEventV1[],
  computedAt: string,
): HomeEventV1[] =>
  [...events].sort((a, b) => {
    const d = rankOf(b, computedAt) - rankOf(a, computedAt);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });

/**
 * Reorder so the RENDERED prefix is diverse, without inventing an order for the rest.
 *
 * ⚠️ IT NEVER PROMOTES A STALE ROW TO FILL A QUOTA. The pass takes the best-ranked row of
 * each unseen category in turn, then falls back to plain rank — so a category with nothing
 * recent simply does not appear, which is the honest outcome. „At least three categories
 * WHEN THE MATERIAL PERMITS" is a description of this loop, not a promise the loop makes
 * true by force.
 */
export const diversify = (ordered: HomeEventV1[]): HomeEventV1[] => {
  const prefix: HomeEventV1[] = [];
  const used = new Map<HomeEventCategory, number>();
  const rest = [...ordered];

  // Pass 1: one per category, best first — this is what buys the category floor.
  for (let i = 0; i < rest.length && prefix.length < MIN_CATEGORIES; i++) {
    const e = rest[i];
    if (used.has(e.category)) continue;
    prefix.push(e);
    used.set(e.category, 1);
    rest.splice(i, 1);
    i -= 1;
  }
  // Pass 2: fill by rank, honouring the per-category cap.
  for (let i = 0; i < rest.length && prefix.length < RENDERED; i++) {
    const e = rest[i];
    if ((used.get(e.category) ?? 0) >= MAX_PER_CATEGORY) continue;
    prefix.push(e);
    used.set(e.category, (used.get(e.category) ?? 0) + 1);
    rest.splice(i, 1);
    i -= 1;
  }
  return [...prefix, ...rest];
};

const run = async (): Promise<void> => {
  const ctx: AdapterContext = { root: ROOT, readJson };

  const all: HomeEventV1[] = [];
  const sourceCoverage: HomeFeedV1["sourceCoverage"] = {};
  const vintages: string[] = [];

  for (const a of ADAPTERS) {
    const r = a.run(ctx);
    // A family that could not be read is REPORTED, never silently dropped: „nothing
    // happened" and „we could not look" are different answers and only one is about the
    // world.
    sourceCoverage[a.id] = {
      available: r.available,
      ...(r.newest ? { asOf: r.newest } : {}),
    };
    if (r.newest) vintages.push(r.newest);
    all.push(...r.events);
  }

  if (all.length === 0) {
    console.warn(
      "home_feed: no adapter produced an event — refusing to overwrite a good artifact " +
        "with an empty one",
    );
    return;
  }

  const computedAt = [...vintages].sort().at(-1);
  if (!computedAt) {
    console.warn(
      "home_feed: no source vintage — refusing to write an artifact that cannot date itself",
    );
    return;
  }

  // ⚠️ THE END of the newest source day, not its midnight. The vintages are DAYS while the
  // events are INSTANTS — an open call opens at 14:30 — so a midnight stamp would be
  // EARLIER than events it claims to cover, and „computedAt is this artifact's vintage"
  // would be false for every same-day row. End-of-day is the honest reading: everything up
  // to the close of that day.
  const asOf = `${computedAt}T23:59:59.999Z`;
  // The window, anchored on the sources. A row newer than `asOf` cannot exist by
  // construction (that day is their maximum), so only the lower bound is applied.
  const floor = new Date(
    Date.parse(asOf) - WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const inWindow = all.filter((e) => displayDate(e) >= floor);

  // ⚠️ IDS MUST BE UNIQUE, and a collision is a bug rather than something to dedupe away:
  // two different facts sharing an id means one of them is unreachable and the browser's
  // list keys are wrong.
  const byId = new Map<string, HomeEventV1>();
  for (const e of inWindow) {
    if (byId.has(e.id))
      throw new Error(
        `duplicate event id: ${e.id} — an adapter's id is not unique`,
      );
    byId.set(e.id, e);
  }

  const events = diversify(orderEvents([...byId.values()], asOf)).slice(
    0,
    MAX_EVENTS,
  );

  const out: HomeFeedV1 = {
    schemaVersion: 1,
    computedAt: asOf,
    windowDays: WINDOW_DAYS,
    events,
    sourceCoverage: Object.fromEntries(
      Object.keys(sourceCoverage)
        .sort()
        .map((k) => [k, sourceCoverage[k]]),
    ),
  };

  const stray = findNowRelativeFields(out);
  if (stray.length > 0)
    throw new Error(
      `home_feed: stored a now-relative field (${stray.join(", ")}) — see NOW_RELATIVE_FIELD_NAMES`,
    );
  for (const e of out.events) {
    if (!HOME_EVENT_CATEGORIES.includes(e.category))
      throw new Error(`unknown category on ${e.id}: ${e.category}`);
    if (!HOME_DATE_BASES.includes(e.dateBasis))
      throw new Error(`unknown dateBasis on ${e.id}: ${e.dateBasis}`);
    if (!e.route.startsWith("/"))
      throw new Error(`event route is not in-app: ${e.id} -> ${e.route}`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const body = JSON.stringify(out, null, 2) + "\n";
  const bytes = Buffer.byteLength(body);
  if (bytes > 64 * 1024)
    throw new Error(`home_feed: ${bytes} bytes exceeds the 64 KiB ceiling`);
  const tmp = `${OUT}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, OUT);

  const cats = new Set(out.events.slice(0, RENDERED).map((e) => e.category));
  console.log(
    `home_feed: ${out.events.length} events (${inWindow.length} in window of ${all.length}) ` +
      `· ${cats.size} categories in the first ${RENDERED} · computedAt=${computedAt} · ${bytes} bytes`,
  );
};

if (process.argv[1] && process.argv[1].includes("gen_home/feed")) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { run };
