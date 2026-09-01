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
import {
  ADAPTERS,
  STALE_AFTER_DAYS,
  type AdapterContext,
} from "./events/adapters";
import { lagDays } from "./period";

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
/**
 * …and no more than this many of one category in the ARTIFACT.
 *
 * ⚠️ `MAX_PER_CATEGORY` PROTECTS THE SIX THE PAGE RENDERS AND NOTHING ELSE, so the reason
 * written on it — „or one busy source becomes the whole feed" — was happening anyway one row
 * down: measured on the first committed artifact, 24 of 40 rows were council resolutions from
 * three protocols, and one whole category was down to a single row. The tail is what a later
 * „see all" reads, so it needs its own (looser) ceiling.
 */
export const MAX_PER_CATEGORY_ARTIFACT = 12;

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
  /** …and the subset that may safely END the window — see the fold below. */
  const observed: string[] = [];

  for (const a of ADAPTERS) {
    const r = a.run(ctx);
    // A family that could not be read is REPORTED, never silently dropped: „nothing
    // happened" and „we could not look" are different answers and only one is about the
    // world.
    // ⚠️ `disclosedAsOf` WHERE THE FAMILY HAS ONE, and it is NOT `newest`. `newest` decides
    // where the window ends and must be the freshest date the family saw; what a reader is told
    // about the family's currency must be its STALEST arm, or a 23-day-old ДФЗ crawl is
    // published as current because ИСУН ran this morning.
    const asOf = r.disclosedAsOf !== undefined ? r.disclosedAsOf : r.newest;
    sourceCoverage[a.id] = {
      available: r.available,
      ...(asOf ? { asOf } : {}),
      // ⚠️ RECORDED so the `computedAt` fold below is auditable from the artifact alone. Only
      // the crawl-based families have an observation clock, and only those may end the window.
      ...(r.vintageBasis === "crawl" && r.newest
        ? { observedAt: r.newest }
        : {}),
    };
    if (r.newest) {
      vintages.push(r.newest);
      if (r.vintageBasis === "crawl") observed.push(r.newest);
    }
    all.push(...r.events);
  }

  if (all.length === 0) {
    console.warn(
      "home_feed: no adapter produced an event — refusing to overwrite a good artifact " +
        "with an empty one",
    );
    return;
  }

  // ⚠️ THE WINDOW ENDS AT THE NEWEST **OBSERVATION**, NOT AT THE NEWEST DATE ANY ROW CARRIES.
  // A crawl timestamp cannot be in the future — it is when we looked. An event date can be: a
  // scheduled election, a forecast period, a call published before it opens. Taking the plain
  // max let one open call dated 2026-12-01 drag the window three months forward, which took 65
  // in-window events down to 1 and announced „данни към 01.12.2026" for an August corpus. That
  // family was fixed at its source; this is the guard for the five that derive a vintage from
  // event dates, and it is the only clock-free one that survives these corpora — see
  // `vintageOf`'s header in adapters.ts for the two corpus-relative clamps that do not.
  //
  // Every family still reports its OWN vintage in `sourceCoverage`: an event-dated family
  // claiming more than we observed is the source's claim, faithfully passed on.
  const computedAt = [...observed].sort().at(-1) ?? [...vintages].sort().at(-1);
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
  // The window, anchored on the sources. ⚠️ BOTH BOUNDS, and the upper one is new: „a row
  // newer than `asOf` cannot exist by construction" was true while `asOf` was the plain maximum
  // over every family, and is not true now that it is the newest OBSERVATION. An event-dated
  // family may carry a row past it, and such a row has not happened yet.
  const floor = new Date(
    Date.parse(asOf) - WINDOW_DAYS * 86_400_000,
  ).toISOString();
  // ⚠️ REVIEW-GATED ROWS NEVER REACH THE ARTIFACT. `intlDebtAdapter` builds Eurobond rows from
  // a HAND-MAINTAINED file with no crawler and no watcher behind it, so a terms error there
  // would be published as a claim about the Republic's own borrowing with nothing able to
  // catch it. Phase 5's rule is „do not auto-publish until a structured authority exists"; the
  // rows are built, counted and listable so the family can be promoted by changing one field,
  // and they are dropped here. The count is REPORTED rather than swallowed — a review queue
  // nobody can see is the same as no queue.
  const staged = all.filter((e) => e.verification !== "automatic");
  const automatic = all.filter((e) => e.verification === "automatic");
  const inWindow = automatic.filter(
    (e) => displayDate(e) >= floor && displayDate(e) <= asOf,
  );

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

  const ranked = diversify(orderEvents([...byId.values()], asOf));
  // The artifact-level cap, applied to the RANKED order so each category keeps its best rows.
  const perCategory = new Map<HomeEventCategory, number>();
  const events = ranked
    .filter((e) => {
      const n = perCategory.get(e.category) ?? 0;
      if (n >= MAX_PER_CATEGORY_ARTIFACT) return false;
      perCategory.set(e.category, n + 1);
      return true;
    })
    .slice(0, MAX_EVENTS);

  // ⚠️ THE REFUSAL BELONGS ON WHAT IS WRITTEN, NOT ON WHAT WAS BUILT. The `all.length` guard
  // above covers „no adapter produced anything"; this covers the case that actually reaches
  // production — every row falling outside the window. It is reachable by the mechanism this
  // file documents: `openCallsAdapter` contributes a CRAWL date as its vintage, so a run in
  // which only the crawler moved, and every call it found opened over a month ago, yields a
  // `computedAt` with nothing inside the window. Every gate then passes vacuously (a cap holds
  // at zero, a per-row loop runs zero times) and the browser shows the outage state for a
  // corpus that is fine. The sibling generator refuses exactly this and says why.
  if (events.length === 0) {
    console.warn(
      `home_feed: ${all.length} event(s) built but none inside the ${WINDOW_DAYS}-day window ` +
        `ending ${computedAt} — refusing to overwrite a good artifact with an empty one. ` +
        `The newest source vintage may be a crawl date; check whether an ingest is stalled.`,
    );
    return;
  }

  // ⚠️ STAMPED HERE, NOT IN THE ADAPTERS, because staleness is measured against `computedAt`
  // and no adapter knows it. „Behind" is a relation between a family's own vintage and the
  // newest thing anybody observed, so it can only be decided once every family has run.
  for (const [id, c] of Object.entries(sourceCoverage)) {
    const ceiling = STALE_AFTER_DAYS[id as keyof typeof STALE_AFTER_DAYS];
    if (!c || ceiling == null) continue;
    c.staleAfterDays = ceiling;
    // ⚠️ A CADENCE WITH NO VINTAGE IS STALE, not exempt. „Reported through `available`" only
    // holds when `available` is false, and an adapter can legitimately return
    // `{ available: true, newest: null }` — `intlDebtAdapter` does. Skipping such a family
    // left it permanently unchecked while its ceiling was printed beside it.
    if (!c.asOf) {
      c.stale = true;
      continue;
    }
    // ⚠️ CALENDAR DAYS on both sides — `lagDays`. `asOf` here is end-of-day, so subtracting the
    // instants inflated every lag by one and fired every ceiling a day early.
    c.stale = lagDays(asOf, c.asOf) > ceiling;
  }
  const behind = Object.entries(sourceCoverage).filter(([, c]) => c?.stale);

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
  // ⚠️ REPORTED, NEVER FATAL. A stale source is a fact about the WORLD or about an ingest, and
  // refusing to publish would replace „one family is behind" with „the whole page is gone" —
  // the strictly worse outcome. The watcher surfaces this line; the artifact carries the same
  // per-family flags so a consumer can say so too.
  if (behind.length > 0)
    console.warn(
      `home_feed: source(s) behind their declared cadence — ` +
        behind
          .map(([id, c]) => `${id} (${c!.asOf}, ceiling ${c!.staleAfterDays}d)`)
          .join(", "),
    );
  if (staged.length > 0)
    console.log(
      `home_feed: ${staged.length} row(s) held for editorial review, not published` +
        (process.argv.includes("--include-review")
          ? `\n  ${staged.map((e) => `${e.id} (${displayDate(e).slice(0, 10)})`).join("\n  ")}`
          : " — pass --include-review to list them"),
    );
};

if (process.argv[1] && process.argv[1].includes("gen_home/feed")) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { run };
