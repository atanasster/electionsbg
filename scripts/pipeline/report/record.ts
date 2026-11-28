// The machine-readable record of one pipeline run (`run.json`), and where a
// run's artifacts live.
//
// Two tiers on purpose:
//   state/pipeline/runs/<session>/   COMMITTED, small: run.json, report.md,
//                                    failures/*.md — readable on any machine
//   logs/pipeline/<session>/         gitignored, full per-step logs
//
// report.md and every failure packet are rendered FROM run.json and nothing
// else, so the human-readable and machine-readable views cannot disagree.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { StepOutcome } from "../exec/executor";
import type { Classification } from "../exec/classify";
import type { StepResult } from "../exec/result";
import { PIPELINE_STATE_DIR, REPO } from "../state";

export const RUNS_DIR = path.join(PIPELINE_STATE_DIR, "runs");
export const LOGS_DIR = path.join(REPO, "logs/pipeline");
export const RUN_SCHEMA = 1;
/** Committed run folders kept; older ones are pruned by the runner. */
export const KEEP_RUNS = 90;

export const runDir = (session: string): string => path.join(RUNS_DIR, session);
export const logDir = (session: string): string => path.join(LOGS_DIR, session);

export type RunKind = "ingest" | "publish";
export type Verdict = "clean" | "degraded" | "failed";

export interface StepRecord {
  seq: number;
  id: string;
  command: string;
  phase: string;
  status: StepOutcome["status"];
  exitCode: number | null;
  durationMs: number;
  /** Median of this step's earlier ok durations, when there is history. */
  medianMs?: number;
  log: string;
  firstError?: string;
  failure?: Classification;
  result?: StepResult;
  resultError?: string;
  chainOf?: string;
  /** Repo-relative path of this step's repair packet, when it failed. */
  packet?: string;
}

export interface GateRecord {
  id: string;
  ok: boolean;
  expected: string;
  observed: string;
}

export interface UnitRecord {
  /** A handler id (ingest) or a publish block ("bucket", "cloud"). */
  id: string;
  status:
    | "ok"
    | "partial"
    | "failed"
    | "blocked"
    | "needs-operator"
    | "skipped";
  why?: string;
  stamped?: boolean;
  /** Sources whose change this run covers. */
  sources?: string[];
  summary?: string;
  steps: StepRecord[];
  gates: GateRecord[];
  filesChanged?: string[];
  /** Repo-relative path of the repair packet for this unit's failed gate(s),
   *  when a gate (not a step) is what failed it. */
  gatePacket?: string;
}

export interface RunRecord {
  schema: typeof RUN_SCHEMA;
  session: string;
  kind: RunKind;
  startedAt: string;
  endedAt?: string;
  git: { shaStart: string | null; shaEnd?: string | null };
  env: Record<string, { ok: boolean; detail: string }>;
  units: UnitRecord[];
  /** Things the operator must do, and things handed to an agent. */
  needsOperator: {
    unit: string;
    id: string;
    instruction: string;
    url?: string;
    dropDir?: string;
  }[];
  needsAgent: { unit: string; id: string; instruction: string; doc: string }[];
  /** Report-only findings (db:check-*, watcher errors, warnings). */
  findings: string[];
  publish?: { decision: "go" | "held" | "n/a"; heldBecause: string[] };
  /** Set on an ingest run that went on to publish (the nightly path): what
   *  the publish did, so this report never tells a reader to run a publish
   *  that already ran. */
  published?: { exitCode: number; report?: string };
  /** Publish runs: digest of the manifest content they worked from, so a
   *  resume can prove it continues the SAME work list. */
  manifestDigest?: string;
  verdict?: Verdict;
  /** Exit code the runner returns. */
  exitCode?: number;
}

export const toStepRecord = (
  o: StepOutcome,
  medianMs?: number,
): StepRecord => ({
  seq: o.seq,
  id: o.id,
  command: o.command,
  phase: o.phase,
  status: o.status,
  exitCode: o.exitCode,
  durationMs: o.durationMs,
  medianMs,
  log: o.log,
  firstError: o.firstError,
  failure: o.failure,
  result: o.result,
  resultError: o.resultError,
  chainOf: o.chainOf,
});

/** Verdict from the units: any failed unit fails the run; anything not ok but
 *  not failed (blocked, operator, partial) degrades it. */
export const verdictOf = (rec: RunRecord): Verdict => {
  if (rec.units.some((u) => u.status === "failed")) return "failed";
  if (
    rec.units.some((u) => u.status !== "ok" && u.status !== "skipped") ||
    rec.needsOperator.length > 0 ||
    rec.needsAgent.length > 0 ||
    rec.publish?.decision === "held" ||
    (rec.published !== undefined && rec.published.exitCode !== 0)
  )
    return "degraded";
  return "clean";
};

/** Write run.json atomically (temp + rename): a crash mid-write must not
 *  leave a half file that the next report render chokes on. */
export const writeRecord = (
  rec: RunRecord,
  dir: string = runDir(rec.session),
): string => {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "run.json");
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return file;
};

export const readRecord = (
  session: string,
  dir: string = runDir(session),
): RunRecord =>
  JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8")) as RunRecord;

/** Run folders under `dir` that hold at least one git-TRACKED file. An
 *  error (not a repository, git missing) reads as "none tracked". */
export const trackedRunDirs = (dir: string): Set<string> => {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--", "."], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 60_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    return new Set(
      out
        .split("\0")
        .filter(Boolean)
        .map((p) => p.split("/")[0]),
    );
  } catch {
    return new Set();
  }
};

/** Keep the newest `keep` run folders (session ids sort chronologically),
 *  deleting the older ones — but by default ONLY those git does not track.
 *  Deleting a COMMITTED run folder leaves tracked deletions in the working
 *  tree that nothing in the run commits, and the concurrent auto-committer
 *  then sweeps them into an unrelated commit. A caller that does commit the
 *  deletions passes `{ tracked: true }` and adds the returned folders
 *  (relative to `dir`) to its commit pathspec. Returns what was deleted. */
export const pruneRuns = (
  keep: number = KEEP_RUNS,
  dir: string = RUNS_DIR,
  opt: { tracked?: boolean } = {},
): string[] => {
  if (!fs.existsSync(dir)) return [];
  const all = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
  const old = all.slice(0, Math.max(0, all.length - keep));
  const tracked = opt.tracked ? new Set<string>() : trackedRunDirs(dir);
  const drop = old.filter((d) => !tracked.has(d));
  for (const d of drop)
    fs.rmSync(path.join(dir, d), { recursive: true, force: true });
  return drop;
};
