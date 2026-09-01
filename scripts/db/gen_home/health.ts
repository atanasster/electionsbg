// Is the home page's data current, and is what the browser fetches what we committed?
//
//   npm run home:health               # the committed artifacts
//   npm run home:health -- --public   # …and what the bucket actually serves
//
// ⚠️ IT ANSWERS FOUR QUESTIONS THAT LOOK LIKE ONE, AND THEY FAIL DIFFERENTLY.
//
//   1. „Did the generators run?" — the artifacts exist, parse and declare their version.
//   2. „Has the PIPELINE stalled?" — the artifact's own age against the wall clock. This is the
//      one a within-artifact measure structurally cannot answer, see below.
//   3. „Is each SOURCE current?" — every family against its own declared cadence
//      (`STALE_AFTER_DAYS`), plus both artifacts' vintages against each other.
//   4. „Is the artifact PUBLISHED?" — `--public` fetches the two objects a browser reads and
//      compares them to the committed bytes.
//
// ⚠️ QUESTIONS 2 AND 3 ARE NOT THE SAME QUESTION, AND CONFLATING THEM IS HOW THIS FILE WAS
// WRONG. `stale` is frozen into the artifact by `feed.ts` and measured against that artifact's
// OWN `computedAt` — so it says „is this family behind the freshest family in this same file",
// never „is this file current". If the whole pipeline stops, `computedAt` stops with it, every
// lag is unchanged, and a purely relative check prints „healthy" for ever. That is exactly the
// blindness this tool exists to fix in `db:check-generated` (which compares LOCAL BYTES against
// the BUCKET: when a generator never re-runs, disk and bucket are both stale, they AGREE, and
// it prints OK) — reproduced one level up. Hence `ARTIFACT_STALE_AFTER_DAYS`, an ABSOLUTE arm.
//
// Reading the clock is allowed HERE and nowhere near the generators: this script writes
// nothing, so it has no byte-identical rebuild to preserve.
//
// Exits non-zero on any of the four, so a watcher run can report red rather than printing a
// warning into a log nobody reads.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  HomeFeedV1,
  HomeHubStatsV1,
} from "../../../src/data/home/homeTypes";
import { STALE_AFTER_DAYS } from "./events/adapters";
import { lagDays } from "./period";
/**
 * The bucket the site reads — IMPORTED, never restated.
 *
 * ⚠️ From `lib/bucket.ts`, which is IMPORT-FREE — not from `check_generated_artifacts.ts`,
 * which also holds a correct copy and runs its `main()` at import time, so taking the constant
 * from there made this script perform a full nine-artifact bucket audit on startup.
 *
 * ⚠️ And not `VITE_DATA_BASE_URL` from the environment: this runs in a terminal where that
 * variable is usually unset, and an empty base would turn every check into a same-origin fetch
 * that cannot fail informatively.
 */
import { BUCKET_URL as DATA_BASE } from "../lib/bucket";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/** The two objects a browser fetches, and the committed file each must equal. */
export const PUBLIC_ARTIFACTS = [
  { file: "data/home/hub_stats.json", object: "home/hub_stats.json" },
  { file: "data/home/feed.json", object: "home/feed.json" },
] as const;

/**
 * How far the ARTIFACT ITSELF may fall behind today before the pipeline counts as stalled.
 *
 * ⚠️ A DIFFERENT QUANTITY FROM `STALE_AFTER_DAYS`, which compares families to each other inside
 * one artifact and therefore cannot move when every generator stops. A week is generous: the
 * feed's own window is 30 days and the price corpus reports daily.
 */
export const ARTIFACT_STALE_AFTER_DAYS = 7;

export type ProblemKind =
  | "missing"
  | "corrupt"
  | "schema"
  | "unbuilt"
  | "unavailable"
  | "stale"
  | "unpublished"
  | "drifted";

export interface Problem {
  kind: ProblemKind;
  detail: string;
}

type Read<T> =
  | { ok: true; value: T }
  | { ok: false; why: "missing" | "corrupt"; detail: string };

/** ⚠️ „ABSENT" AND „UNPARSEABLE" ARE DIFFERENT FIXES — run the generator, or `git checkout`. */
const readJson = <T>(rel: string): Read<T> => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return { ok: false, why: "missing", detail: rel };
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(p, "utf8")) as T };
  } catch (e) {
    return {
      ok: false,
      why: "corrupt",
      detail: `${rel}: ${(e as Error).message}`,
    };
  }
};

export interface HomeArtifacts {
  stats: HomeHubStatsV1 | null;
  feed: HomeFeedV1 | null;
  problems: Problem[];
}

/** Parse both artifacts ONCE, so a verdict and a summary can never describe different files. */
export const loadArtifacts = (): HomeArtifacts => {
  const problems: Problem[] = [];
  const s = readJson<HomeHubStatsV1>("data/home/hub_stats.json");
  const f = readJson<HomeFeedV1>("data/home/feed.json");
  for (const r of [s, f])
    if (!r.ok) problems.push({ kind: r.why, detail: r.detail });
  return {
    stats: s.ok ? s.value : null,
    feed: f.ok ? f.value : null,
    problems,
  };
};

/**
 * @param now injected so the absolute arm is testable — a clock-reading check that can only be
 * exercised on the day it was written is not a check.
 */
export const checkArtifacts = (
  a: HomeArtifacts = loadArtifacts(),
  now: number = Date.now(),
): Problem[] => {
  const problems = [...a.problems];
  const { stats, feed } = a;

  if (stats && stats.schemaVersion !== 1)
    problems.push({
      kind: "schema",
      detail: `hub_stats schemaVersion ${stats.schemaVersion}`,
    });
  if (feed && feed.schemaVersion !== 1)
    problems.push({
      kind: "schema",
      detail: `feed schemaVersion ${feed.schemaVersion}`,
    });

  // ── the absolute arm: has anything been LOOKED AT lately? ──────────────────────────
  //
  // ⚠️ MEASURED ON THE NEWEST OBSERVATION, NOT ON `computedAt`. Both artifacts date themselves
  // by their newest SOURCE vintage, so „the file is 32 days old" conflates two states that need
  // opposite responses: a stalled pipeline, and a source set that is genuinely old. `hub_stats`
  // folds quarterly macro and the sibling hub blobs, so a computedAt weeks back is its ORDINARY
  // state and flagging it would be a false positive on every run — the first cut did exactly
  // that. `observedAt` is a crawl clock and only the crawl-based families carry one, so a week
  // without one moving means nobody has looked, which is the thing worth waking someone for.
  const newestObservation = Object.values(feed?.sourceCoverage ?? {})
    .map((c) => c?.observedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (newestObservation) {
    const age = Math.floor(
      (now - Date.parse(`${newestObservation}T23:59:59.999Z`)) / 86_400_000,
    );
    if (age > ARTIFACT_STALE_AFTER_DAYS)
      problems.push({
        kind: "unbuilt",
        detail:
          `no source has been observed since ${newestObservation} (${age}d) — the ingest or ` +
          `the generators have stopped`,
      });
  } else if (feed) {
    // Every crawl-based family lost its clock: the fold that anchors the window has nothing
    // left to anchor on, and `computedAt` silently fell back to an event date.
    problems.push({
      kind: "unbuilt",
      detail:
        "no family reported an observation date — computedAt is anchored on event dates",
    });
  }

  // ── the hub-stats arm ───────────────────────────────────────────────────────────────
  if (stats) {
    for (const [id, s] of Object.entries(stats.sources ?? {}))
      if (s && !s.available)
        problems.push({
          kind: "unavailable",
          detail: `hub_stats ${id}: source unreadable`,
        });
    // ⚠️ THE TWO VINTAGES ARE NOT COMPARABLE, and asserting they should match is a false
    // positive on every run. They fold DIFFERENT source sets: the feed's newest is a daily
    // price crawl, `hub_stats`' is quarterly macro and the sibling hub blobs — measured 32 days
    // apart on a perfectly healthy pair. Both dates are PRINTED side by side in the summary so
    // an operator sees the gap and can judge it; neither is a failure on its own.
  }

  if (!feed) return problems;

  // ── the per-family arm ──────────────────────────────────────────────────────────────
  for (const [id, c] of Object.entries(feed.sourceCoverage)) {
    if (!c) continue;
    if (!c.available) {
      // „We could not look" is a different failure from „nothing happened", and it has its own
      // kind so a watcher summary can count them apart.
      problems.push({
        kind: "unavailable",
        detail: `${id}: source unreadable`,
      });
      continue;
    }
    const live = STALE_AFTER_DAYS[id as keyof typeof STALE_AFTER_DAYS];
    // ⚠️ THE VERDICT IS COMPUTED LIVE, not read from the stored `stale`. That flag was decided
    // against whatever the constant held when the artifact was generated, so tightening a
    // ceiling used to change the PRINTED number and not the verdict — and the run still exited
    // 0. The stored flag stays in the artifact for browser consumers; here the code's current
    // declaration is the authority, and a disagreement is reported rather than hidden.
    if (live == null) continue;
    if (!c.asOf) {
      problems.push({
        kind: "unavailable",
        detail: `${id}: declares a ${live}d cadence but no vintage`,
      });
      continue;
    }
    if (c.staleAfterDays != null && c.staleAfterDays !== live)
      problems.push({
        kind: "stale",
        detail:
          `${id}: the artifact was built against a ${c.staleAfterDays}d ceiling, the code ` +
          `now declares ${live}d — regenerate the feed`,
      });
    const lag = lagDays(feed.computedAt, c.asOf);
    if (lag > live)
      problems.push({
        kind: "stale",
        detail: `${id}: last moved ${c.asOf}, ${lag}d behind, ceiling ${live}d`,
      });
  }
  return problems;
};

/**
 * What the bucket actually serves.
 *
 * ⚠️ `db:check-generated` IS THE STRICTER AUTHORITY and covers all three home artifacts with an
 * md5 of the decompressed body. This is the narrower, page-scoped check that also verifies the
 * STORED CONTENT-ENCODING — the whole reason `home:publish` is two commands is that
 * `gsutil rsync -j json` sets a transport encoding only, and nothing else automates that.
 *
 * The comparison is over the PARSED value rather than the bytes, which is deliberately weaker:
 * it tolerates cosmetic reserialisation and answers „is the published content ours". Byte
 * equality is `db:check-generated`'s job; do not "fix" that one down to this.
 */
export const checkPublic = async (): Promise<Problem[]> => {
  const problems: Problem[] = [];
  for (const { file, object } of PUBLIC_ARTIFACTS) {
    const local = readJson<unknown>(file);
    if (!local.ok) continue; // already reported by loadArtifacts
    let body: string;
    let storedEncoding: string | null;
    try {
      // ⚠️ `no-store` because the ops runbook fetches this IMMEDIATELY after publishing, which
      // is the worst possible moment to read an intermediary's cached copy; and a timeout
      // because this runs inside an automated orchestrator where a hung socket is a hung run.
      const r = await fetch(`${DATA_BASE}/${object}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        problems.push({
          kind: "unpublished",
          detail: `${object} → HTTP ${r.status}`,
        });
        continue;
      }
      storedEncoding = r.headers.get("x-goog-stored-content-encoding");
      body = await r.text();
    } catch (e) {
      problems.push({
        kind: "unpublished",
        detail: `${object} → ${(e as Error).message}`,
      });
      continue;
    }
    // ⚠️ THE HEADER, NOT THE BODY. `bucket:gz` did not cover these objects at all for a while,
    // so both were served `identity` on the entry page's critical path while every document
    // said a sync would „revert the gzip a previous bucket:gz established" — a rationale for a
    // command that was doing nothing. The body looks identical either way; only this says so.
    if (storedEncoding !== "gzip")
      problems.push({
        kind: "unpublished",
        detail:
          `${object} is stored as ${storedEncoding ?? "identity"} — run npm run bucket:gz ` +
          `(a bucket:sync:paths reverts it)`,
      });
    try {
      if (JSON.stringify(JSON.parse(body)) !== JSON.stringify(local.value))
        problems.push({
          kind: "drifted",
          detail: `${object} differs from the committed ${file}`,
        });
    } catch {
      problems.push({ kind: "schema", detail: `${object} is not JSON` });
    }
  }
  return problems;
};

const run = async (): Promise<void> => {
  const artifacts = loadArtifacts();
  const problems = checkArtifacts(artifacts);
  if (process.argv.includes("--public"))
    problems.push(...(await checkPublic()));

  const { stats, feed } = artifacts;
  if (stats)
    console.log(`home: hub_stats computedAt ${stats.computedAt.slice(0, 10)}`);
  if (feed) {
    console.log(
      `home: feed computedAt ${feed.computedAt.slice(0, 10)} · ${feed.events.length} events`,
    );
    for (const [id, c] of Object.entries(feed.sourceCoverage).sort()) {
      if (!c) continue;
      const lag = c.asOf ? lagDays(feed.computedAt, c.asOf) : null;
      const ceiling = STALE_AFTER_DAYS[id as keyof typeof STALE_AFTER_DAYS];
      console.log(
        `  ${id.padEnd(12)} ${c.available ? "ok " : "DOWN"} ` +
          `${(c.asOf ?? "—").padEnd(10)}  ` +
          (lag === null
            ? "no vintage"
            : ceiling == null
              ? `${lag}d behind · no cadence`
              : `${lag}d behind · ceiling ${ceiling}d${lag > ceiling ? "  ⚠ STALE" : ""}`),
      );
    }
  }

  if (problems.length === 0) {
    console.log("home: healthy");
    return;
  }
  for (const p of problems) console.error(`home: ${p.kind} — ${p.detail}`);
  process.exit(1);
};

if (process.argv[1] && process.argv[1].includes("gen_home/health")) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { run };
