// Phase 7's gating measurement: do home-feed event IDs survive 30 days of real corpus movement?
//
//   npx tsx scripts/db/gen_home/id_stability.ts [--days 30] [--json]
//
// ⚠️ THIS IS THE THING THAT DECIDES WHETHER WATCHLISTS ARE BUILDABLE, and it is not a style
// question. A watch cursor is `{ subjectKey, lastSeenEventId }` — so an id is a PROMISE that
// „this row is the same fact you already saw". Two ways to break it, and they fail oppositely:
//
//   CHURN     — the id changes while the fact does not. Every subscriber is re-notified about
//               something they have already read. An alert product built on this cries wolf
//               until nobody looks.
//   MUTATION  — the id stays while the fact changes. The cursor marks the NEW fact as already
//               seen, so the reader is never told. Silent, and worse.
//
// ⚠️ AND IT IS A REPLAY OVER REAL HISTORY, not a simulation. The adapters are pure functions of
// committed files, so `git archive` at a past commit reconstructs exactly what the generator
// would have produced that day. A synthetic „imagine a new row arrives" test would measure the
// perturbation somebody imagined rather than the ones the sources actually perform — and the
// two defects above were both found in shapes nobody would have thought to simulate.
//
// Plan: docs/plans/home-dashboard-implementation-v1.md Phase 7.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HomeEventV1 } from "../../../src/data/home/homeTypes";
import { ADAPTERS, type AdapterContext } from "./events/adapters";
import { WINDOW_DAYS, displayDate } from "./feed";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * Everything the adapters read, as `git archive` pathspecs.
 *
 * ⚠️ `data/home/price_events.json` IS IN THE LIST even though it is generated: at a past commit
 * it holds what the price generator wrote THEN, which is exactly the input the feed had. Leaving
 * it out would replay the price arm against today's measurements and report perfect stability
 * for the one family whose ids are derived rather than quoted.
 */
const SOURCE_PATHS = [
  "data/council",
  "data/parliament/votes/index.json",
  "data/opencalls",
  "data/home/price_events.json",
  "data/debt-emissions-domestic.json",
  "data/debt-emissions.json",
  "data/budget/documents.json",
  "data/budget/kfp.json",
  "data/macro.json",
  "state/watch/eurostat.json",
  "src/data/json/elections.json",
];

const git = (...args: string[]): string =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });

/** One commit per day, the last that touched any source at or before that day. */
export const checkpoints = (days: number): { day: string; sha: string }[] => {
  const lines = git(
    "log",
    `--since=${days} days ago`,
    "--format=%H %cI",
    "--",
    ...SOURCE_PATHS,
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const byDay = new Map<string, string>();
  // `git log` is newest-first, so the FIRST sha seen for a day is that day's latest state.
  for (const l of lines) {
    const [sha, iso] = l.split(" ");
    const day = iso.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, sha);
  }
  return [...byDay.entries()]
    .map(([day, sha]) => ({ day, sha }))
    .sort((a, b) => a.day.localeCompare(b.day));
};

/**
 * Materialise ONE source path at one commit.
 *
 * ⚠️ „ABSENT AT THIS COMMIT" AND „THE EXTRACTION FAILED" MUST NOT BE THE SAME OUTCOME, and the
 * first cut made them so — twice over. `git archive … | tar` is a PIPELINE, so its status is
 * `tar`'s, and `tar` exits 0 on empty stdin; and stderr was discarded, so a pathspec typo, a
 * corrupt object or a full disk was byte-for-byte indistinguishable from a path that did not
 * exist yet. The bias is one-directional and lands on the load-bearing claim: a source that
 * silently fails to materialise makes its adapter emit nothing, which contributes zero churn
 * and zero mutation. Silence makes the answer look better.
 */
const extract = (sha: string, p: string, dir: string): "ok" | "absent" => {
  const r = spawnSync(
    "bash",
    [
      "-c",
      `set -o pipefail; git archive ${sha} -- '${p}' | tar -x -C '${dir}'`,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (r.status === 0) return "ok";
  if (/did not match any files/.test(r.stderr ?? "")) return "absent";
  throw new Error(
    `git archive ${sha} -- ${p} failed: ${(r.stderr ?? "").trim()}`,
  );
};

/**
 * Run every adapter against one commit's sources.
 *
 * `byFamily` accumulates the number of CHECKPOINTS each family was present at, so `run()` can
 * report it — a family present at one checkpoint takes part in zero transitions, and its clean
 * churn score is not evidence of anything.
 */
export const eventsAt = (
  sha: string,
  byFamily?: Map<string, number>,
): HomeEventV1[] => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "home-idstab-"));
  try {
    for (const p of SOURCE_PATHS) extract(sha, p, dir);
    const ctx: AdapterContext = {
      root: dir,
      readJson: <T>(rel: string): T | null => {
        const f = path.join(dir, rel);
        if (!fs.existsSync(f)) return null;
        try {
          return JSON.parse(fs.readFileSync(f, "utf8")) as T;
        } catch {
          return null;
        }
      },
    };
    const out: HomeEventV1[] = [];
    for (const a of ADAPTERS) {
      const evs = a.run(ctx).events;
      if (byFamily && evs.length > 0)
        byFamily.set(a.id, (byFamily.get(a.id) ?? 0) + 1);
      out.push(...evs);
    }
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * The row identity a churn test needs: what the event SAYS, independent of its id.
 *
 * ⚠️ `scope` IS PART OF THE FACT, and leaving it out made the mutation class that matters most
 * invisible. A cursor is SUBJECT-KEYED, so a row whose `scope.id` moves from one município to
 * another under a stable id re-points at a different subscriber set — silently, and it is the
 * same defect family as the 2026-08-18 „Разград published 131 decisions that were not its own",
 * which happened to manifest as removals rather than as scope rewrites. `coverage.complete` is
 * in for the same reason: flipping it under a stable id adds or drops a reader-facing
 * disclosure.
 */
const factOf = (e: HomeEventV1): string =>
  JSON.stringify([
    ...factCore(e),
    displayDate(e).slice(0, 10),
    e.scope.level,
    e.scope.id ?? null,
    e.dateBasis,
    e.coverage.complete,
  ]);

/**
 * The same identity WITHOUT the date.
 *
 * ⚠️ THIS IS WHAT MAKES `churned = 0` MEAN ANYTHING. Churn against the dated identity is only
 * detected when a re-key leaves the displayed day untouched — and the one shape the design is
 * claimed to have closed, a promotion id carrying its walk-back start day, moved the id AND the
 * date together, so it would have landed in `appeared`. Both are reported; a gap between them is
 * the finding.
 */
const factCore = (e: HomeEventV1): unknown[] => [
  e.factKey,
  e.route,
  e.factArgs,
];
const factCoreOf = (e: HomeEventV1): string => JSON.stringify(factCore(e));

/**
 * ⚠️ EVERY COUNTER COMES IN TWO FLAVOURS AND THE TWO MUST NEVER BE SUMMED OR COMPARED.
 *
 * The adapters emit EVERYTHING they can see — council resolutions back to 2024 — while the feed
 * publishes only what falls inside a 30-day window. A mutation on a row eleven months out of
 * window is real corpus instability and CANNOT have been delivered to anybody, so a verdict
 * about watch cursors rests on the in-window figure alone. The first cut applied the window to
 * `vanished` only and reported „appeared 1,608 · mutated 10" beside it; in-window those are far
 * smaller, and the audit's worked example turned out to be a row that was eleven months
 * unpublishable on the day it changed.
 */
export interface DayDiff {
  day: string;
  total: number;
  /** Of `total`, the rows the feed would actually have published that day. */
  totalInWindow: number;
  /** New ids whose FACT is also new — an event genuinely appearing. */
  appeared: number;
  /** …of which inside the publication window. The only ones a subscriber could receive. */
  appearedInWindow: number;
  /** Ids that left while their displayed date was still inside the window. */
  vanished: number;
  /** Ids that left because they aged out — the window moving, not instability. */
  agedOut: number;
  /** ⚠️ Same fact, different id — a re-notification about something already read. */
  churned: number;
  churnedInWindow: number;
  /** ⚠️ Churn detected WITHOUT the date — a re-key that moved the id and the displayed day
   *  together, which the dated test scores as `appeared`. The promotion-id shape exactly. */
  churnedLoose: number;
  /** ⚠️ Same id, different fact — a cursor marks the NEW fact as seen. Silent. */
  mutated: number;
  mutatedInWindow: number;
  churnExamples: string[];
  mutationExamples: string[];
}

export const diffDays = (
  prev: HomeEventV1[],
  next: HomeEventV1[],
  day: string,
): DayDiff => {
  const prevById = new Map(prev.map((e) => [e.id, e]));
  const nextById = new Map(next.map((e) => [e.id, e]));
  const prevByFact = new Map(prev.map((e) => [factOf(e), e]));
  const nextByFact = new Map(next.map((e) => [factOf(e), e]));
  const prevByCore = new Map(prev.map((e) => [factCoreOf(e), e]));

  // The window moves with the corpus, so a row leaving because it aged out is not instability.
  const floor = new Date(
    Date.parse(`${day}T00:00:00.000Z`) - WINDOW_DAYS * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);

  const inWindow = (e: HomeEventV1): boolean => {
    const d = displayDate(e).slice(0, 10);
    return d >= floor && d <= day;
  };

  let appeared = 0;
  let appearedInWindow = 0;
  let vanished = 0;
  let agedOut = 0;
  let churned = 0;
  let churnedInWindow = 0;
  let churnedLoose = 0;
  const looseExamples: string[] = [];
  let mutated = 0;
  let mutatedInWindow = 0;
  const churnExamples: string[] = [];
  const mutationExamples: string[] = [];

  for (const [id, e] of nextById) {
    if (prevById.has(id)) {
      if (factOf(prevById.get(id)!) !== factOf(e)) {
        mutated++;
        if (inWindow(e)) {
          mutatedInWindow++;
          // ⚠️ EXAMPLES COME FROM THE IN-WINDOW SET ONLY. The first cut took whichever came
          // first and illustrated the finding with a row dated 2025-09-30 — eleven months
          // unpublishable on the day it changed — so the sentence it supported described a
          // delivery that could not have occurred.
          if (mutationExamples.length < 3) mutationExamples.push(id);
        }
      }
      continue;
    }
    // A new id. Did its FACT already exist under a different one?
    const was = prevByFact.get(factOf(e));
    // …and the DATE-FREE question, which is the one that catches a re-key that moved both.
    const wasLoose = prevByCore.get(factCoreOf(e));
    if (was) {
      churned++;
      if (inWindow(e)) {
        churnedInWindow++;
        if (churnExamples.length < 3) churnExamples.push(`${was.id} → ${id}`);
      }
    } else {
      appeared++;
      if (inWindow(e)) appearedInWindow++;
    }
    if (!was && wasLoose && wasLoose.id !== id) {
      churnedLoose++;
      if (looseExamples.length < 3)
        looseExamples.push(
          `${wasLoose.id} → ${id} (date ${displayDate(wasLoose).slice(0, 10)} → ${displayDate(e).slice(0, 10)})`,
        );
    }
  }
  for (const [, e] of prevById) {
    if (nextById.has(e.id) || nextByFact.has(factOf(e))) continue;
    // Ageing out is the window moving, not instability — counted separately so a large number
    // there cannot be read as a corpus losing rows.
    if (displayDate(e).slice(0, 10) >= floor) vanished++;
    else agedOut++;
  }

  return {
    day,
    total: next.length,
    totalInWindow: next.filter(inWindow).length,
    appeared,
    appearedInWindow,
    vanished,
    agedOut,
    churned,
    churnedInWindow,
    churnedLoose,
    mutated,
    mutatedInWindow,
    churnExamples: churnExamples.length ? churnExamples : looseExamples,
    mutationExamples,
  };
};

const run = (): void => {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--days");
  const days = i >= 0 ? Number(argv[i + 1]) : 30;
  if (!Number.isInteger(days) || days < 2)
    throw new Error(
      `--days needs an integer ≥ 2, got ${argv[i + 1] ?? "(nothing)"}`,
    );

  const points = checkpoints(days);
  if (points.length < 2) {
    console.log(
      `id stability · only ${points.length} checkpoint(s) in ${days} days — not measurable`,
    );
    return;
  }

  const byFamily = new Map<string, number>();
  const diffs: DayDiff[] = [];
  let prev = eventsAt(points[0].sha, byFamily);
  for (const p of points.slice(1)) {
    const next = eventsAt(p.sha, byFamily);
    diffs.push(diffDays(prev, next, p.day));
    prev = next;
  }

  if (argv.includes("--json")) {
    console.log(
      JSON.stringify({ days, points: points.length, diffs }, null, 2),
    );
    return;
  }

  const sum = (f: (d: DayDiff) => number) =>
    diffs.reduce((a, d) => a + f(d), 0);
  console.log(
    `id stability · ${points.length} checkpoints, ${points[0].day} … ${points[points.length - 1].day}`,
  );
  console.log(
    "  ⚠️ IN-WINDOW is the only basis a verdict may rest on: the adapters emit everything they",
  );
  console.log(
    "     can see, the feed publishes a 30-day slice, and a mutation on an unpublishable row",
  );
  console.log("     cannot have been delivered to anybody.");
  console.log(
    "  day          events in-win  appear in-win  vanish  agedOut  CHURN in-win  MUTATE in-win",
  );
  for (const d of diffs)
    console.log(
      `  ${d.day}  ${String(d.total).padStart(6)} ${String(d.totalInWindow).padStart(6)}  ` +
        `${String(d.appeared).padStart(6)} ${String(d.appearedInWindow).padStart(6)}  ` +
        `${String(d.vanished).padStart(6)} ${String(d.agedOut).padStart(8)}  ` +
        `${String(d.churned).padStart(5)} ${String(d.churnedInWindow).padStart(6)}  ` +
        `${String(d.mutated).padStart(6)} ${String(d.mutatedInWindow).padStart(6)}`,
    );
  console.log(
    `  totals: appeared ${sum((d) => d.appeared)} (${sum((d) => d.appearedInWindow)} in-window) · ` +
      `vanished ${sum((d) => d.vanished)} · aged out ${sum((d) => d.agedOut)} · ` +
      `churned ${sum((d) => d.churned)} (${sum((d) => d.churnedInWindow)} in-window) · ` +
      `mutated ${sum((d) => d.mutated)} (${sum((d) => d.mutatedInWindow)} in-window)`,
  );
  // ⚠️ THE DATE-FREE CHURN COUNT, and a divergence from the dated one IS the finding: a re-key
  // that moves the id and the displayed day together scores as `appeared` above.
  console.log(
    `  date-free churn: ${sum((d) => d.churnedLoose)} — a re-key that moved the date too would ` +
      `appear here and NOT in the column above`,
  );
  // ⚠️ A FAMILY PRESENT AT ONE CHECKPOINT TAKES PART IN ZERO TRANSITIONS, so its clean churn
  // score is not evidence of anything. `data/home/price_events.json` was added on the LAST
  // checkpoint of the first run, so the one family with derived ids — the one Phase 5 changed —
  // was never actually measured, while the audit cited the run as evidence that it was.
  console.log("  family participation:");
  for (const a of ADAPTERS) {
    const n = byFamily.get(a.id) ?? 0;
    console.log(
      `    ${a.id.padEnd(12)} present at ${String(n).padStart(2)}/${points.length} checkpoints` +
        (n < 2 ? "  ⚠ 0 transitions — NOT evidence of stability" : ""),
    );
  }
  const ex = diffs.flatMap((d) => d.churnExamples).slice(0, 5);
  if (ex.length)
    console.log(`  in-window churn examples:\n    ${ex.join("\n    ")}`);
  const mx = diffs.flatMap((d) => d.mutationExamples).slice(0, 5);
  if (mx.length)
    console.log(`  in-window mutation examples:\n    ${mx.join("\n    ")}`);
};

if (process.argv[1] && process.argv[1].includes("gen_home/id_stability")) {
  try {
    run();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

export { run };
