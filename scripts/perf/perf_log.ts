// Append-only performance trace for the two orchestrator skills.
//
// `/process-watch-report` (ingest) and `/upload-watch-changes` (publish) both
// run long chains of shell commands — `db:refresh` alone is a ~70-link `&&`
// chain, and a cloud publish is a dozen `:cloud` loaders over a proxy. A single
// wall-clock number for the whole run says only "it was slow"; to decide what
// to OPTIMISE we need one row per step, kept across runs so a regression is
// visible as a change against that step's own history.
//
// So each run writes one JSONL file per orchestrator, APPENDED never truncated:
//
//   state/perf/process-watch-report.jsonl
//   state/perf/upload-watch-changes.jsonl
//
// One line per step, one `session` per orchestrator invocation. JSONL rather
// than JSON specifically because appending must never rewrite what is already
// there: a crashed or interrupted run keeps every step it did finish, which is
// the run you most want the trace for.
//
// ⚠️ These files are COMMITTED. They are the trace — a per-machine gitignored
// log would be empty on the machine that later does the optimisation work, and
// the `logs`/`*.log` ignore rules are why the extension is `.jsonl`.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PERF_DIR = path.resolve(__dirname, "../../state/perf");

/** Which orchestrator produced a trace. One JSONL file per value. */
export type PerfRun = "process-watch-report" | "upload-watch-changes";

export type PerfStatus = "ok" | "error" | "skipped";

export interface PerfStep {
  /** When the step ENDED (ISO UTC). Sort key within a session. */
  ts: string;
  /** Orchestrator that produced this row — matches the file name. */
  run: string;
  /** One id per orchestrator invocation; groups rows into a run. */
  session: string;
  /** 1-based position within the session, as recorded. */
  seq: number;
  /** Stable label. Compared ACROSS sessions, so keep it deterministic. */
  step: string;
  /** Coarse grouping: plan | ingest | derive | verify | publish | commit. */
  phase?: string;
  /** The shell command, when the step was one. */
  command?: string;
  startedAt: string;
  durationMs: number;
  status: PerfStatus;
  exitCode?: number;
  /** Free-text: counts, row totals, why it was skipped. */
  notes?: string;
  /** Payload size in bytes, for upload steps. */
  bytes?: number;
}

export const logPath = (run: string, dir: string = PERF_DIR): string =>
  path.join(dir, `${run}.jsonl`);

/**
 * A session id sorts chronologically as a plain string and carries a random
 * suffix so two runs started in the same second cannot merge into one.
 */
export const newSessionId = (
  at: Date = new Date(),
  suffix?: string,
): string => {
  const iso = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const rand = suffix ?? Math.random().toString(16).slice(2, 6);
  return `${iso}-${rand}`;
};

/** Append one row. Creates the file and directory on first use. */
export const appendStep = (
  step: PerfStep,
  dir: string = PERF_DIR,
): PerfStep => {
  fs.mkdirSync(dir, { recursive: true });
  // One `\n`-terminated line, written with a single appendFileSync so a
  // concurrent reader never sees a half-row.
  fs.appendFileSync(logPath(step.run, dir), JSON.stringify(step) + "\n");
  return step;
};

/**
 * Read a trace back. Malformed lines are SKIPPED rather than thrown on — a
 * truncated final line (killed mid-append) must not make the whole history
 * unreadable, which is the one job an append-only log has.
 */
export const readSteps = (
  run: string,
  dir: string = PERF_DIR,
): { steps: PerfStep[]; skippedLines: number } => {
  const file = logPath(run, dir);
  if (!fs.existsSync(file)) return { steps: [], skippedLines: 0 };
  const steps: PerfStep[] = [];
  let skippedLines = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as PerfStep;
      if (typeof row.step === "string" && typeof row.durationMs === "number")
        steps.push(row);
      else skippedLines += 1;
    } catch {
      skippedLines += 1;
    }
  }
  return { steps, skippedLines };
};

/** `1h 04m 12s` / `3m 07s` / `812ms` — fixed width enough to scan a column. */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0)
    return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
};

export interface SessionSummary {
  session: string;
  startedAt: string;
  endedAt: string;
  /** Sum of the steps' own durations — NOT end-to-start; see below. */
  totalMs: number;
  stepCount: number;
  failures: number;
  skipped: number;
  slowest: PerfStep[];
}

/**
 * Per-session rollup.
 *
 * ⚠️ `totalMs` is the SUM OF STEP DURATIONS, never `endedAt - startedAt`. The
 * gap between two steps is the agent thinking, the user answering a prompt, or
 * a manual download — real wall-clock, but not work this trace can attribute or
 * optimise. Reporting it as "the run took X" would credit the pipeline with
 * time it never spent.
 */
export const summarizeSessions = (
  steps: PerfStep[],
  slowestN = 5,
): SessionSummary[] => {
  const bySession = new Map<string, PerfStep[]>();
  for (const s of steps) {
    const list = bySession.get(s.session);
    if (list) list.push(s);
    else bySession.set(s.session, [s]);
  }
  const out: SessionSummary[] = [];
  for (const [session, rows] of bySession) {
    const sorted = [...rows].sort((a, b) => a.ts.localeCompare(b.ts));
    out.push({
      session,
      startedAt: sorted.reduce(
        (min, r) => (r.startedAt < min ? r.startedAt : min),
        sorted[0].startedAt,
      ),
      endedAt: sorted[sorted.length - 1].ts,
      totalMs: rows.reduce((n, r) => n + r.durationMs, 0),
      stepCount: rows.length,
      failures: rows.filter((r) => r.status === "error").length,
      skipped: rows.filter((r) => r.status === "skipped").length,
      slowest: [...rows]
        .filter((r) => r.status !== "skipped")
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, slowestN),
    });
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
};

export interface StepSummary {
  step: string;
  runs: number;
  totalMs: number;
  medianMs: number;
  maxMs: number;
  lastMs: number;
  lastAt: string;
  failures: number;
}

export const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
};

/**
 * Per-step rollup across sessions — the optimisation worklist.
 *
 * Ranked by TOTAL time, not by median: a 4 s step run 60 times costs more than
 * a 90 s step run once, and the cheapest win is usually the one that repeats.
 * `skipped` rows are excluded from the timings (a skip is ~0 ms and would drag
 * the median of a step that is genuinely slow when it runs) but the row is
 * still counted in `runs` so a mostly-skipped step is visible as such.
 */
export const summarizeSteps = (steps: PerfStep[]): StepSummary[] => {
  const byStep = new Map<string, PerfStep[]>();
  for (const s of steps) {
    const list = byStep.get(s.step);
    if (list) list.push(s);
    else byStep.set(s.step, [s]);
  }
  const out: StepSummary[] = [];
  for (const [step, rows] of byStep) {
    const timed = rows.filter((r) => r.status !== "skipped");
    const durations = timed.map((r) => r.durationMs);
    const last = [...rows].sort((a, b) => a.ts.localeCompare(b.ts)).at(-1)!;
    out.push({
      step,
      runs: rows.length,
      totalMs: durations.reduce((n, d) => n + d, 0),
      medianMs: median(durations),
      maxMs: durations.length ? Math.max(...durations) : 0,
      lastMs: last.durationMs,
      lastAt: last.ts,
      failures: rows.filter((r) => r.status === "error").length,
    });
  }
  return out.sort((a, b) => b.totalMs - a.totalMs);
};
