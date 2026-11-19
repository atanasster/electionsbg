// The ingest runner: plan → run each handler → gates → stamp → changelog →
// post-steps → commit → manifest → publish gate. Plan §2 / Tier 2; it replaces
// the procedure in .claude/skills/process-watch-report/SKILL.md.
//
// Contract kept from that runbook, each line a documented failure mode:
//   - handlers run strictly in sequence (they share data/);
//   - a failed handler is failed — never "completed with warnings" — and its
//     marker is NOT stamped, so it re-queues next run;
//   - a failure does not stop the run (unattended policy "skip and continue"),
//     but it HOLDS the publish;
//   - human and agent steps are listed, never guessed;
//   - commit by explicit pathspec only; publish only through the manifest.
//
// Handlers whose runner is still "skill" are DELEGATED: listed under "Needs
// agent" with their runbook, not run here, not stamped (plan Tier 2) — and a
// script handler that runs `after` one of them waits for it.
//
// Ordering of the durable writes is the point of this file: a stamped marker
// promises the work will be published, so the manifest is written as soon as
// the first handler succeeds and again after the commit — and an unexpected
// error anywhere after that still finalizes the report and holds the publish.
// When the commit FAILS (or --no-commit), the promise is withdrawn instead:
// every marker this run stamped, the changelog and the manifest go back to
// their pre-run copies, so the work re-queues rather than reading "done".
//
// Post-steps (registry/post_steps.ts) run after the handlers have been
// stamped, so a failed or need-skipped post-step cannot re-queue through a
// marker. It is recorded as OWED in state/pipeline/owed_post_steps.json and
// re-selected by every later run until it succeeds — and it holds the
// publish of the run that could not complete it.

import type { IngestState } from "../lib/ingest-state";
import type { UploadManifest } from "../lib/upload-manifest";
import { newSessionId } from "../perf/perf_log";
import type { WatchState } from "../watch/types";
import type { DoctorResult } from "./doctor";
import {
  isInterrupted,
  recordSkip,
  type RunContext,
  type StepOutcome,
  type StepSpec,
} from "./exec/executor";
import type { CommitResult } from "./git";
import {
  plan,
  type BootstrapPolicy,
  type Plan,
  type PlanEntry,
} from "./planner";
import { orderCloud, stepNeeds, type Handler, type Need } from "./registry";
import { runGates, type Gate, type GateCtx } from "./registry/gates";
import { selectPostSteps, type PostStep } from "./registry/post_steps";
import {
  logDir,
  runDir,
  toStepRecord,
  type RunRecord,
  type UnitRecord,
} from "./report/record";
import path from "node:path";
import { medianIndex } from "./report/finalize";
import { REPO } from "./state";

export const PERF_RUN = "process-watch-report";
export const CHANGELOG_FILE = "data/data-changes.json";
export const PENDING_FILE = "state/upload/pending.json";
/** Post-steps a run could not complete; every later run re-selects them. */
export const OWED_POST_STEPS = "state/pipeline/owed_post_steps.json";
/** Exit code for a run stopped by SIGINT/SIGTERM/SIGHUP (128 + SIGINT). */
export const EXIT_INTERRUPTED = 130;
export const markerPath = (marker: string): string =>
  `state/ingest/${marker}.json`;

export type WriteResult = { ok: true } | { ok: false; error: string };

export interface IngestDeps {
  handlers: readonly Handler[];
  postSteps: readonly PostStep[];
  doctor: () => Promise<DoctorResult>;
  loadState: () => {
    watch: Map<string, WatchState>;
    ingest: Map<string, IngestState>;
    acks: Map<string, string>;
    errors: string[];
  };
  sourceLabel: (sourceId: string) => string | undefined;
  run: (
    spec: StepSpec & { kind?: "command" | "chain" },
    ctx: RunContext,
  ) => Promise<StepOutcome[]>;
  /** A repo file's text, or null when absent — for restore-on-failure. */
  readFile: (rel: string) => string | null;
  /** Put a file back as it was (null = it did not exist). Also how the
   *  runner writes its own small state (the owed post-steps). */
  restoreFile: (rel: string, text: string | null) => void;
  /** A step log's full text (repo-relative path), capped by the wiring —
   *  what output gates read. Absent or null = fall back to the 120-line tail. */
  readLog?: (rel: string) => string | null;
  /** The signal the run was interrupted by, if any. Defaults to the
   *  executor's process-wide flag; injectable for tests. */
  isInterrupted?: () => NodeJS.Signals | null;
  stamp: (marker: string, summary: string, at: string) => void;
  appendChange: (args: {
    skill: string;
    summary: string;
    source?: string;
  }) => void;
  /** path → "mtime:size" for every file under `paths` that differs from
   *  `sinceSha` or is untracked. Taken before and after a handler, the
   *  difference is what THIS run wrote — whatever else was already dirty, and
   *  whether or not an auto-committer committed it in between. */
  outputSignature: (
    paths: readonly string[],
    sinceSha: string | null,
  ) => Map<string, string>;
  staged: (paths: readonly string[]) => string[];
  commit: (
    message: string,
    paths: readonly string[],
    exclude: readonly string[],
  ) => CommitResult;
  head: () => string | null;
  generatedPaths: (files: readonly string[]) => string[];
  writeManifest: (
    m: Partial<UploadManifest> & { session: string },
  ) => WriteResult;
  /** Top-level data/ entries matching `re` modified at or after `sinceMs`. */
  dataDirsTouched: (re: RegExp, sinceMs: number) => string[];
  /** Files under `paths` that differ from `sinceSha` AND were modified at or
   *  after `sinceMs` — what a run wrote into a folder it does not own. */
  filesWrittenSince: (
    paths: readonly string[],
    sinceSha: string | null,
    sinceMs: number,
  ) => string[];
  snapshotBaselines: (gates: readonly Gate[]) => Map<string, unknown>;
  gateCtx: (output: string, baselines: Map<string, unknown>) => GateCtx;
  lock: (session: string) => {
    release: () => void;
    tookOver?: { pid: number; session: string };
  };
  finalize: (rec: RunRecord) => string;
  /** Run the publish; returns its exit code (and, when it got that far, the
   *  publish run's own report). */
  publish: (heldLock: {
    session: string;
  }) => Promise<number | { exitCode: number; report?: string }>;
  /** Prune old COMMITTED run folders (finalize only prunes untracked ones)
   *  and return their repo-relative paths: each is a deletion this run made,
   *  so it goes in the report commit's pathspec. Absent = none pruned. */
  pruneTrackedRuns?: () => string[];
  /** After an ABORT_CLASSES failure: is the environment STILL broken? A
   *  local Postgres that restarted mid-load is back seconds later, and
   *  aborting the night over a blip would skip every later handler for
   *  nothing. Absent = assume broken. */
  envStillBroken?: (failureClass: string) => Promise<boolean>;
  log: (line: string) => void;
}

export interface IngestOptions {
  session?: string;
  only?: ReadonlySet<string>;
  bootstrap?: BootstrapPolicy;
  /** Publish after a clean ingest (the nightly path). */
  publish?: boolean;
  /** Plan and stop. */
  dryRun?: boolean;
  /** Do not commit (local experiments). Holds the publish, and stamps
   *  nothing: no marker, no manifest, no changelog row, no owed post-steps —
   *  an uncommitted run must not read as done to the next one. */
  noCommit?: boolean;
  perfDir?: string;
  /** Units and findings from before the ingest (the nightly watcher), so one
   *  report covers the whole chain. */
  preamble?: { units: UnitRecord[]; findings: string[] };
  /** Step numbers already used by the caller (the nightly watcher), so the
   *  run's log files and run.log lines keep one sequence. */
  seqStart?: number;
}

/** Failure classes that mean the ENVIRONMENT is broken, not the handler: once
 *  one is seen, every later handler would fail the same way (each burning its
 *  own timeout), so the run stops there instead. */
export const ABORT_CLASSES: ReadonlySet<string> = new Set([
  "db-local-down",
  "db-auth",
  "disk",
]);

export interface IngestOutcome {
  exitCode: number;
  plan: Plan;
  record?: RunRecord;
  report?: string;
  publishExit?: number;
}

/** Every run's own bookkeeping, committed whatever happened. */
const BOOKKEEPING = [
  "state/ingest",
  "state/perf/process-watch-report.jsonl",
  CHANGELOG_FILE,
  "state/pipeline/acks.json",
  OWED_POST_STEPS,
];

const summarize = (outs: readonly StepOutcome[]): string => {
  const own = outs
    .map((o) => o.result?.summary)
    .filter((s): s is string => !!s);
  if (own.length) return own.join("; ");
  const ran = outs.filter((o) => o.status === "ok").length;
  return `${ran} step(s) ok`;
};

const changedBetween = (
  before: Map<string, string>,
  after: Map<string, string>,
): string[] =>
  [...after]
    .filter(([f, sig]) => before.get(f) !== sig)
    .map(([f]) => f)
    .sort();

interface Succeeded {
  entry: PlanEntry;
  handler: Handler;
  dirs: string[];
  /** Every file the handler wrote THIS run — under its outputs and inside
   *  `dirs`. Committed one by one, never a whole folder: stale leftovers and
   *  other sessions' edits may live there. */
  files: string[];
}

/** A run record for a run that stopped before (or instead of) running any
 *  handler — the planning failure here, and every early stop in
 *  pipeline:nightly. */
export const stoppedRecord = (a: {
  session: string;
  startedAt: string;
  sha: string | null;
  doctor?: DoctorResult | null;
  units: UnitRecord[];
  findings: string[];
  exitCode: number;
}): RunRecord => ({
  schema: 1,
  session: a.session,
  kind: "ingest",
  startedAt: a.startedAt,
  endedAt: new Date().toISOString(),
  git: { shaStart: a.sha, shaEnd: a.sha },
  env: a.doctor
    ? Object.fromEntries(
        a.doctor.checks.map((c) => [c.id, { ok: c.ok, detail: c.detail }]),
      )
    : {},
  units: a.units,
  needsOperator: [],
  needsAgent: [],
  findings: a.findings,
  publish: { decision: "n/a", heldBecause: [] },
  exitCode: a.exitCode,
});

/** The owed post-step ids on disk (a corrupt file reads as none, reported). */
const readOwed = (deps: IngestDeps, findings: string[]): string[] => {
  const text = deps.readFile(OWED_POST_STEPS);
  if (text === null) return [];
  try {
    const v = JSON.parse(text) as unknown;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
    throw new Error("not a list of post-step ids");
  } catch (e) {
    findings.push(
      `${OWED_POST_STEPS} does not parse (${e instanceof Error ? e.message : String(e)}); treated as owing nothing — check it by hand`,
    );
    return [];
  }
};

/** The needs-agent item for steps the planner could not scope: the entry is
 *  left unstamped, so the change re-queues — but it re-queues for ever
 *  unless someone runs the step with the scope the watcher could not give. */
const scopeItem = (h: Handler, entry: PlanEntry) => ({
  unit: h.id,
  id: "scope-missing",
  instruction: `Could not scope ${entry.scopeSkipped
    .map((s) => `${s.id} (${s.why})`)
    .join(
      "; ",
    )} for ${entry.flipped.join(", ")}. Run it with the scope the runbook names, then stamp state/ingest/${entry.marker}.json — until then the change re-queues every run.`,
  doc: `.claude/skills/${h.skill ?? h.id}/SKILL.md`,
});

const safeHead = (deps: IngestDeps): string | null => {
  try {
    return deps.head();
  } catch {
    return null;
  }
};

export const runIngest = async (
  deps: IngestDeps,
  opt: IngestOptions = {},
): Promise<IngestOutcome> => {
  const session = opt.session ?? newSessionId();
  const interruptedBy = deps.isInterrupted ?? isInterrupted;
  let doctor: DoctorResult;
  let thePlan: Plan;
  try {
    doctor = await deps.doctor();
    const state = deps.loadState();
    thePlan = plan({
      handlers: deps.handlers,
      watch: state.watch,
      ingest: state.ingest,
      acks: state.acks,
      now: new Date(),
      bootstrap: opt.bootstrap ?? "ask",
      unmet: doctor.unmet,
      only: opt.only,
      inputErrors: state.errors,
    });
  } catch (e) {
    // Nothing ran and nothing was stamped — but the reader still needs a
    // report saying so, not the previous session's.
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    deps.log(`✗ the run could not plan: ${msg.split("\n")[0]}`);
    const emptyPlan: Plan = {
      schema: 1,
      generatedAt: new Date().toISOString(),
      bootstrap: opt.bootstrap ?? "ask",
      entries: [],
      followUps: [],
      cloud: [],
      unrouted: [],
      warnings: [],
    };
    if (opt.dryRun) throw e;
    const rec = stoppedRecord({
      session,
      startedAt: new Date().toISOString(),
      sha: safeHead(deps),
      units: [
        ...(opt.preamble?.units ?? []),
        {
          id: "runner",
          status: "failed",
          why: `planning failed: ${msg.split("\n")[0]}`,
          steps: [],
          gates: [],
        },
      ],
      findings: [
        ...(opt.preamble?.findings ?? []),
        `runner error before any handler ran: ${msg.split("\n").slice(0, 6).join(" | ")}`,
      ],
      exitCode: 2,
    });
    let report: string | undefined;
    try {
      report = deps.finalize(rec);
    } catch (fe) {
      deps.log(
        `report could not be written either: ${fe instanceof Error ? fe.message : String(fe)}`,
      );
    }
    return { exitCode: 2, plan: emptyPlan, record: rec, report };
  }
  if (opt.dryRun) return { exitCode: 0, plan: thePlan };

  // Held to the very end — through the publish and the final report commit.
  // acquireLock is re-entrant within one process, so the publish runner's
  // own acquisition is a no-op rather than a window another run could take.
  const lock = deps.lock(session);
  const byId = new Map(deps.handlers.map((h) => [h.id, h]));
  const rec: RunRecord = {
    schema: 1,
    session,
    kind: "ingest",
    startedAt: new Date().toISOString(),
    git: { shaStart: deps.head() },
    env: Object.fromEntries(
      doctor.checks.map((c) => [c.id, { ok: c.ok, detail: c.detail }]),
    ),
    units: [...(opt.preamble?.units ?? [])],
    needsOperator: [],
    needsAgent: [],
    findings: [
      ...(opt.preamble?.findings ?? []),
      ...thePlan.warnings,
      ...(thePlan.unrouted.length
        ? [`unrouted watcher sources: ${thePlan.unrouted.join(", ")}`]
        : []),
    ],
  };
  if (lock.tookOver)
    rec.findings.push(
      `took over a stale lock from session ${lock.tookOver.session} (pid ${lock.tookOver.pid})`,
    );

  let seq = opt.seqStart ?? 0;
  const ctx: RunContext = {
    perfRun: PERF_RUN,
    session,
    logDir: logDir(session),
    nextSeq: () => ++seq,
    perfDir: opt.perfDir,
    medianMs: medianIndex(PERF_RUN, session, opt.perfDir),
  };
  const unmet = (needs: readonly Need[]): Need[] =>
    needs.filter((n) => doctor.unmet.has(n));
  /** Set when a step failed for an environment reason (ABORT_CLASSES): every
   *  later handler and post-step is skipped with this as the reason. */
  let aborted: string | null = null;
  deps.log(
    `── ingest ${session}: ${thePlan.entries.filter((e) => e.status === "run").length} handler(s) to run, ${thePlan.entries.length} planned`,
  );

  const succeeded: Succeeded[] = [];
  /** handler id → its unit's final status in THIS run. */
  const outcome = new Map<string, UnitRecord["status"]>();
  /** Queued handlers that do NOT hold their `after` dependents — the
   *  runtime twin of planner.ts holdsDependents. */
  const releases = new Set<string>();
  const queued = new Set(thePlan.entries.map((e) => e.handler));
  const heldBecause: string[] = [];
  /** Files a failed handler wrote; never committed by this run. */
  const leftovers = new Set<string>();
  /** Markers this run wrote (or let a self-stamping script write), with
   *  their pre-run text — put back if the work never gets committed. */
  const stampedThisRun: {
    unit: UnitRecord;
    file: string;
    before: string | null;
  }[] = [];
  const changelogAtStart = deps.readFile(CHANGELOG_FILE);
  const pendingAtStart = deps.readFile(PENDING_FILE);
  let manifestWritten = false;

  /** The run's written files, as generated-artifact bucket paths. */
  const generated = (files: readonly string[]): string[] =>
    files.length ? deps.generatedPaths(files) : [];
  const manifestFor = (
    commit?: string,
    posts: { post: PostStep; files: string[] }[] = [],
  ): Partial<UploadManifest> & { session: string } => ({
    session,
    commit,
    skills: succeeded.map((s) => s.handler.skill ?? s.handler.id),
    paths: [
      ...new Set([
        ...succeeded.flatMap((s) => [...s.entry.paths, ...s.dirs]),
        ...posts.flatMap((p) => p.post.publish?.paths ?? []),
        // From what THIS run wrote — never from HEAD, which may hold another
        // session's (or the auto-committer's) unrelated commit.
        ...generated([
          ...succeeded.flatMap((s) => s.files),
          ...posts.flatMap((p) => p.files),
        ]),
      ]),
    ],
    cloudCommands: orderCloud([
      ...succeeded.flatMap((s) => s.entry.cloud),
      ...posts.flatMap((p) => p.post.publish?.cloud ?? []),
    ]),
  });
  const writeManifest = (
    m: Partial<UploadManifest> & { session: string },
  ): void => {
    // An uncommitted run promises nothing to the publisher.
    if (opt.noCommit) return;
    if (!m.paths?.length && !m.cloudCommands?.length) return;
    const w = deps.writeManifest(m);
    if (!w.ok) {
      heldBecause.push(`upload manifest not written: ${w.error}`);
      rec.findings.push(`upload manifest not written: ${w.error}`);
    } else manifestWritten = true;
  };
  /** Withdraw this run's promises: the work did not reach git, so nothing
   *  may read as done — markers, changelog rows and the manifest go back to
   *  their pre-run copies and the handlers re-queue. */
  const unstampAll = (why: string): void => {
    for (const s of stampedThisRun) {
      deps.restoreFile(s.file, s.before);
      s.unit.stamped = false;
    }
    if (stampedThisRun.length)
      rec.findings.push(
        `${why}: restored ${stampedThisRun.length} marker(s) this run stamped (${stampedThisRun.map((s) => s.unit.id).join(", ")}) — they re-queue next run`,
      );
    stampedThisRun.length = 0;
    if (deps.readFile(CHANGELOG_FILE) !== changelogAtStart)
      deps.restoreFile(CHANGELOG_FILE, changelogAtStart);
    if (manifestWritten) deps.restoreFile(PENDING_FILE, pendingAtStart);
  };

  const finish = (): string => {
    rec.endedAt = new Date().toISOString();
    rec.git.shaEnd = deps.head();
    return deps.finalize(rec);
  };
  /** Full step output for gates — the whole log, not the 120-line tail. */
  const stepText = (o: StepOutcome): string =>
    (o.log ? deps.readLog?.(o.log) : null) ?? o.tail;

  try {
    try {
      for (const entry of thePlan.entries) {
        const h = byId.get(entry.handler);
        if (!h) continue;
        const unit: UnitRecord = {
          id: h.id,
          status: "ok",
          sources: entry.flipped,
          steps: [],
          gates: [],
        };
        rec.units.push(unit);
        const settle = (status: UnitRecord["status"], why?: string): void => {
          unit.status = status;
          if (why) unit.why = why;
          outcome.set(h.id, status);
        };
        for (const o of entry.operator)
          rec.needsOperator.push({
            unit: h.id,
            id: o.id,
            instruction: o.instruction,
            url: o.url,
            dropDir: o.dropDir,
          });

        const intr = interruptedBy();
        if (intr) {
          settle("skipped", `runner interrupted (${intr})`);
          continue;
        }
        if (
          aborted &&
          (entry.status === "run" || entry.status === "bootstrap")
        ) {
          settle("skipped", `run aborted: ${aborted}`);
          if (entry.status === "run")
            heldBecause.push(`${h.id}: not run — ${aborted}`);
          continue;
        }
        if (entry.status === "bootstrap") {
          if (entry.bootstrapAction === "seed" && opt.noCommit) {
            settle("skipped", "bootstrap: not seeded under --no-commit");
          } else if (entry.bootstrapAction === "seed") {
            const file = markerPath(entry.marker);
            stampedThisRun.push({ unit, file, before: deps.readFile(file) });
            deps.stamp(
              entry.marker,
              "bootstrap: marker seeded, no run",
              rec.startedAt,
            );
            unit.stamped = true;
            settle("skipped", "bootstrap: marker seeded without running");
          } else {
            settle("needs-operator", entry.why);
            rec.needsOperator.push({
              unit: h.id,
              id: "bootstrap",
              instruction: `No marker yet. Run it (\`pnpm run pipeline:ingest --only ${h.id} --bootstrap run\`) or seed it without running (\`--bootstrap seed\`).`,
            });
          }
          continue;
        }
        if (entry.status !== "run") {
          settle(
            entry.status === "nothing-to-run" ? "skipped" : entry.status,
            entry.why,
          );
          if (entry.status === "needs-operator" && entry.armDeferredOnly)
            releases.add(h.id);
          if (entry.status === "nothing-to-run") {
            rec.findings.push(`${h.id}: ${entry.why}`);
            if (entry.scopeSkipped.length)
              rec.needsAgent.push(scopeItem(h, entry));
          }
          continue;
        }
        // A prerequisite queued in this run must have produced what it was
        // going to produce (planner.ts holdsDependents): failed, blocked,
        // scope-skipped and delegated-to-agent all leave its output at the
        // previous vintage, and a stamped dependent would not re-queue when
        // the prerequisite finally runs.
        const notDone = (h.after ?? []).find(
          (a) => queued.has(a) && !releases.has(a),
        );
        if (notDone) {
          settle(
            "blocked",
            `runs after ${notDone}, which did not complete in this run (${outcome.get(notDone) ?? "not run"})`,
          );
          continue;
        }
        if (h.runner === "skill") {
          settle(
            "skipped",
            `delegated to the ${h.skill ?? h.id} runbook (not yet a script)`,
          );
          const unscoped = entry.scopeSkipped.length
            ? ` Steps the planner could NOT scope — run them too, with the scope the runbook names: ${entry.scopeSkipped
                .map((s) => `${s.id} (${s.why})`)
                .join("; ")}.`
            : "";
          rec.needsAgent.push({
            unit: h.id,
            id: "run-runbook",
            instruction: `Run ${h.skill ?? h.id} for ${entry.flipped.join(", ")}. Planned steps: ${entry.steps
              .filter((s) => s.status === "run")
              .map((s) => s.run)
              .join(" → ")}.${unscoped}`,
            doc: `.claude/skills/${h.skill ?? h.id}/SKILL.md`,
          });
          continue;
        }

        // ---- run the handler
        deps.log(`▶ ${h.id} (${entry.flipped.join(", ")})`);
        const startedAt = new Date().toISOString();
        const startedMs = Date.parse(startedAt);
        const headBefore = deps.head();
        const markerFile = markerPath(entry.marker);
        const markerBefore = deps.readFile(markerFile);
        const changelogBefore =
          h.changelog === "self" ? deps.readFile(CHANGELOG_FILE) : null;
        const outputsBefore = deps.outputSignature(h.outputs ?? [], headBefore);
        const baselines = deps.snapshotBaselines(h.gates ?? []);
        const outs: StepOutcome[] = [];
        let broke: string | null = null;
        const needsSkipped: string[] = [];
        for (const ps of entry.steps) {
          if (ps.status === "skip") continue;
          const def = h.steps.find((s) => s.id === ps.id);
          const spec: StepSpec & { kind?: "command" | "chain" } = {
            id: ps.id,
            run: ps.run,
            phase: ps.phase,
            timeoutMin: ps.timeoutMin,
            okExit: [...(ps.okExit ?? []), ...(def?.operatorExit?.codes ?? [])],
            db: "local",
            kind: ps.kind,
          };
          const missing = def ? unmet(stepNeeds(h, def)) : [];
          if (broke || missing.length || interruptedBy()) {
            if (missing.length && !broke) needsSkipped.push(ps.id);
            outs.push(
              recordSkip(
                spec,
                broke
                  ? `not run: ${broke} failed`
                  : missing.length
                    ? `unmet need(s): ${missing.join(", ")}`
                    : "runner interrupted",
                ctx,
              ),
            );
            continue;
          }
          for (const o of await deps.run(spec, ctx)) {
            outs.push(o);
            if (o.status !== "ok") broke ??= o.id;
            if (
              !aborted &&
              o.status !== "ok" &&
              o.failure &&
              ABORT_CLASSES.has(o.failure.class)
            ) {
              const still = deps.envStillBroken
                ? await deps.envStillBroken(o.failure.class)
                : true;
              if (still)
                aborted = `${h.id} › ${o.id} failed with ${o.failure.class} (${o.firstError ?? "no output"}) and it is still broken — later handlers were not started`;
              else
                rec.findings.push(
                  `${h.id} › ${o.id} failed with ${o.failure.class}, but the environment answered again right after — a transient blip; later handlers ran (re-run ${h.id})`,
                );
            }
          }
        }
        unit.steps = outs.map((o) => toStepRecord(o));
        const wrote = changedBetween(
          outputsBefore,
          deps.outputSignature(h.outputs ?? [], headBefore),
        );
        unit.filesChanged = wrote;

        if (!broke) {
          unit.gates = runGates(
            h.gates ?? [],
            new Set(entry.flipped),
            deps.gateCtx(outs.map(stepText).join("\n"), baselines),
          );
        }
        const gateFailed = unit.gates.some((g) => !g.ok);
        const interrupted = interruptedBy();
        if (broke || gateFailed || interrupted) {
          settle(
            "failed",
            broke
              ? `${broke} failed`
              : gateFailed
                ? `gate(s) failed: ${unit.gates
                    .filter((g) => !g.ok)
                    .map((g) => g.id)
                    .join(", ")}`
                : "runner interrupted",
          );
          unit.stamped = false;
          heldBecause.push(`${h.id}: ${unit.why}`);
          for (const f of wrote) leftovers.add(f);
          // A self-stamping script may have stamped, or appended its changelog
          // row, before the step that failed.
          if (h.stamp === "self") deps.restoreFile(markerFile, markerBefore);
          if (h.changelog === "self")
            deps.restoreFile(CHANGELOG_FILE, changelogBefore);
          deps.log(`✗ ${h.id}: ${unit.why}`);
          if (aborted) {
            rec.findings.push(`run aborted: ${aborted}`);
            deps.log(`■ aborting the run: ${aborted}`);
          }
          continue;
        }

        // A step that exited with one of its operatorExit codes: the check
        // worked and found something only a human can change.
        const opHits = outs.flatMap((o) => {
          const op = h.steps.find((s) => s.id === o.id)?.operatorExit;
          if (!op || o.exitCode === null || !op.codes.includes(o.exitCode))
            return [];
          const text = stepText(o);
          const line =
            (op.detail && text.split("\n").find((l) => op.detail!.test(l))) ||
            o.firstError;
          return [{ o, op, line: line?.trim().slice(0, 400) }];
        });
        if (opHits.length) {
          unit.summary = summarize(outs);
          settle(
            "needs-operator",
            `${opHits.map((x) => x.o.id).join(", ")} exited ${opHits
              .map((x) => x.o.exitCode)
              .join("/")}: a human edit is due (marker not stamped)`,
          );
          unit.stamped = false;
          if (h.stamp === "self") deps.restoreFile(markerFile, markerBefore);
          if (h.changelog === "self")
            deps.restoreFile(CHANGELOG_FILE, changelogBefore);
          for (const { o, op, line } of opHits)
            rec.needsOperator.push({
              unit: h.id,
              id: o.id,
              instruction: `${op.instruction}${line ? ` — ${line}` : ""} (log ${o.log})`,
            });
          for (const f of wrote) leftovers.add(f);
          deps.log(`◆ ${h.id}: ${unit.why}`);
          continue;
        }

        unit.summary = summarize(outs);
        const partial = [
          ...(entry.deferred.length
            ? [`${entry.deferred.join(", ")} deferred to an operator item`]
            : []),
          ...(entry.scopeSkipped.length
            ? [
                `step(s) ${entry.scopeSkipped.map((x) => x.id).join(", ")} could not be scoped`,
              ]
            : []),
          ...(needsSkipped.length
            ? [`step(s) ${needsSkipped.join(", ")} skipped for an unmet need`]
            : []),
        ];
        if (entry.scopeSkipped.length) {
          rec.findings.push(
            `${h.id}: ${entry.scopeSkipped.map((x) => `${x.id} not run — ${x.why}`).join("; ")}; marker left unstamped so the change re-queues`,
          );
          rec.needsAgent.push(scopeItem(h, entry));
        }
        if (partial.length || opt.noCommit) {
          settle(
            partial.length ? "partial" : "ok",
            partial.length
              ? `marker not stamped: ${partial.join("; ")}`
              : undefined,
          );
          unit.stamped = false;
          if (h.stamp === "self") deps.restoreFile(markerFile, markerBefore);
          if (opt.noCommit && !partial.length)
            unit.why = "marker not stamped: --no-commit";
        } else {
          if (h.stamp !== "self")
            deps.stamp(entry.marker, unit.summary, startedAt);
          stampedThisRun.push({ unit, file: markerFile, before: markerBefore });
          unit.stamped = true;
          settle("ok");
        }
        // Only an operator ARM leaves a handler's output complete for its
        // dependents (planner.ts holdsDependents).
        if (!entry.scopeSkipped.length && !needsSkipped.length)
          releases.add(h.id);
        const dirs = h.publish?.dirsMatching
          ? deps.dataDirsTouched(h.publish.dirsMatching, startedMs)
          : [];
        const dirFiles = dirs.length
          ? deps.filesWrittenSince(
              dirs.map((d) => `data/${d}`),
              headBefore,
              startedMs,
            )
          : [];
        unit.filesChanged = [...new Set([...wrote, ...dirFiles])];
        if (
          h.changelog === "orchestrator" &&
          unit.filesChanged.length &&
          !opt.noCommit
        )
          deps.appendChange({
            skill: h.skill ?? h.id,
            summary: unit.summary,
            source: entry.flipped
              .map((s) => deps.sourceLabel(s) ?? s)
              .join("; "),
          });
        for (const a of entry.agent) rec.needsAgent.push({ unit: h.id, ...a });
        succeeded.push({ entry, handler: h, dirs, files: unit.filesChanged });
        deps.log(
          `✓ ${h.id}: ${unit.status}${unit.stamped ? " (marker stamped)" : ""} — ${unit.summary}`,
        );
        // Durable promise first: a stamped marker's work is on the manifest
        // before anything else can go wrong.
        writeManifest(manifestFor());
      }

      // ---- post-steps: those this run's handlers trigger, plus every one an
      // earlier run owes.
      const owedBefore = readOwed(deps, rec.findings);
      const known = new Set(deps.postSteps.map((p) => p.id));
      for (const id of owedBefore.filter((x) => !known.has(x)))
        rec.findings.push(
          `owed post-step ${id} is no longer registered — dropped from ${OWED_POST_STEPS}`,
        );
      const triggered = new Set(
        succeeded.length
          ? selectPostSteps(
              succeeded.flatMap((s) => s.entry.followUps),
              new Set(succeeded.flatMap((s) => s.entry.flipped)),
              deps.postSteps,
            ).map((p) => p.id)
          : [],
      );
      const posts = deps.postSteps.filter(
        (p) => triggered.has(p.id) || owedBefore.includes(p.id),
      );
      const carried = posts.filter(
        (p) => !triggered.has(p.id) && owedBefore.includes(p.id),
      );
      if (carried.length)
        rec.findings.push(
          `post-step(s) owed by an earlier run, re-run now: ${carried.map((p) => p.id).join(", ")}`,
        );
      const postOk: { post: PostStep; files: string[] }[] = [];
      if (posts.length && !aborted)
        deps.log(`── post-steps: ${posts.map((p) => p.id).join(", ")}`);
      for (const p of posts) {
        if (aborted) {
          rec.units.push({
            id: `post:${p.id}`,
            status: "skipped",
            why: `run aborted: ${aborted}`,
            steps: [],
            gates: [],
          });
          continue;
        }
        const unit: UnitRecord = {
          id: `post:${p.id}`,
          status: "ok",
          steps: [],
          gates: [],
        };
        rec.units.push(unit);
        let broke: string | null = null;
        const unmetSkipped: string[] = [];
        const headBefore = deps.head();
        const before = deps.outputSignature(p.outputs ?? [], headBefore);
        for (const s of p.steps) {
          const spec: StepSpec = {
            id: s.id,
            run: s.run,
            phase: s.phase,
            timeoutMin: s.timeoutMin ?? 30,
            okExit: s.okExit,
            db: "local",
          };
          const missing = unmet([...(p.needs ?? []), ...(s.needs ?? [])]);
          if (broke || missing.length || interruptedBy()) {
            unit.steps.push(
              toStepRecord(
                recordSkip(
                  spec,
                  broke
                    ? `not run: ${broke} failed`
                    : missing.length
                      ? `unmet need(s): ${missing.join(", ")}`
                      : "runner interrupted",
                  ctx,
                ),
              ),
            );
            if (!broke) {
              unit.status = "skipped";
              unmetSkipped.push(
                missing.length ? missing.join(", ") : "interrupted",
              );
            }
            continue;
          }
          for (const o of await deps.run(spec, ctx)) {
            unit.steps.push(toStepRecord(o));
            if (o.status !== "ok") broke ??= o.id;
            else if (o.exitCode && spec.okExit?.includes(o.exitCode))
              rec.findings.push(
                `${o.id} exited ${o.exitCode}: it found something — read ${o.log}`,
              );
          }
        }
        const files = changedBetween(
          before,
          deps.outputSignature(p.outputs ?? [], headBefore),
        );
        unit.filesChanged = files;
        if (broke) {
          unit.status = "failed";
          unit.why = `${broke} failed`;
          heldBecause.push(`post-step ${p.id}: ${broke} failed`);
          for (const f of files) leftovers.add(f);
        } else if (unit.status === "skipped") {
          // Its handlers are already stamped: without the hold and the owed
          // record, the derived artifact would publish stale and never be
          // rebuilt.
          unit.why = `not run: ${[...new Set(unmetSkipped)].join("; ")} — owed to the next run`;
          heldBecause.push(`post-step ${p.id}: ${unit.why}`);
        } else postOk.push({ post: p, files });
      }
      const okIds = new Set(postOk.map((p) => p.post.id));
      const owedAfter = [
        ...new Set([...owedBefore, ...posts.map((p) => p.id)]),
      ].filter((id) => known.has(id) && !okIds.has(id));
      if (
        !opt.noCommit &&
        JSON.stringify(owedAfter) !==
          JSON.stringify(owedBefore.filter((id) => known.has(id)))
      )
        deps.restoreFile(
          OWED_POST_STEPS,
          owedAfter.length ? JSON.stringify(owedAfter, null, 2) + "\n" : null,
        );
      if (owedAfter.length)
        rec.findings.push(
          `post-step(s) owed to the next run: ${owedAfter.join(", ")} (${OWED_POST_STEPS})`,
        );

      // ---- commit: exactly the files this run wrote, plus its bookkeeping —
      // never a whole outputs folder (stale leftovers and other sessions'
      // edits under it are not this run's to commit).
      deps.log("── commit");
      const runFolder = path.relative(REPO, runDir(session));
      const written = [
        ...new Set([
          ...succeeded.flatMap((s) => s.files),
          ...postOk.flatMap((p) => p.files),
        ]),
      ];
      const commitPathspec = [
        ...new Set([...written, ...BOOKKEEPING, runFolder]),
      ];
      let commitSha: string | undefined;
      if (opt.noCommit) {
        rec.findings.push(
          "--no-commit: nothing committed, no marker stamped, no manifest written",
        );
        unstampAll("--no-commit");
        if (succeeded.length || postOk.length)
          heldBecause.push("--no-commit: the ingest was not committed");
      } else {
        const staged = deps.staged(commitPathspec);
        if (staged.length) {
          heldBecause.push(
            `already staged by someone else, left out of this commit: ${staged.join(", ")}`,
          );
          rec.findings.push(
            `staged by someone else (left out of this commit): ${staged.join(", ")}`,
          );
        }
        if (leftovers.size)
          rec.findings.push(
            `left uncommitted (written by a failed handler or post-step): ${[...leftovers].slice(0, 30).join(", ")}${leftovers.size > 30 ? ` … +${leftovers.size - 30}` : ""}`,
          );
        const c = deps.commit(
          `watch: ingest ${succeeded.map((s) => s.handler.id).join(", ") || "nothing"} (${session})`,
          commitPathspec,
          [...staged, ...leftovers],
        );
        if (c.status === "failed") {
          heldBecause.push(`commit failed: ${c.error}`);
          rec.findings.push(`commit failed: ${c.error}`);
          unstampAll("commit failed");
        } else if (c.status === "committed") commitSha = c.sha;
        else if (written.length) {
          // Nothing to commit: either the auto-committer already committed
          // this run's files, or they were never there. HEAD is the commit
          // to name ONLY when it provably holds every one of them.
          const head = deps.head();
          if (head && deps.outputSignature(written, head).size === 0)
            commitSha = head;
          else
            rec.findings.push(
              "commit reported nothing to commit, but HEAD does not hold this run's files — the manifest names no commit; check git before publishing",
            );
        }
      }

      // ---- manifest, now with the commit and the post-steps' work
      if (succeeded.length || postOk.length)
        writeManifest(manifestFor(commitSha, postOk));
    } catch (e) {
      // Markers may already be stamped: the report and a held publish are the
      // only way the next reader learns this run did not finish.
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
      rec.findings.push(
        `runner error — the run did not finish: ${msg.split("\n").slice(0, 6).join(" | ")}`,
      );
      heldBecause.push("the runner crashed before finishing");
      rec.units.push({
        id: "runner",
        status: "failed",
        why: msg.split("\n")[0],
        steps: [],
        gates: [],
      });
    }

    const interrupted = interruptedBy();
    if (interrupted) heldBecause.push(`interrupted by ${interrupted}`);
    const didWork =
      succeeded.length > 0 ||
      rec.units.some((u) => u.id.startsWith("post:") && u.status === "ok");
    const publishable =
      succeeded.some(
        (s) => s.entry.paths.length || s.entry.cloud.length || s.dirs.length,
      ) || rec.units.some((u) => u.id.startsWith("post:") && u.status === "ok");
    rec.publish = heldBecause.length
      ? { decision: "held", heldBecause }
      : didWork && publishable
        ? { decision: "go", heldBecause: [] }
        : { decision: "n/a", heldBecause: [] };
    const anyFailed = rec.units.some((u) => u.status === "failed");
    rec.exitCode = interrupted
      ? EXIT_INTERRUPTED
      : anyFailed
        ? 1
        : rec.publish.decision === "held"
          ? 4
          : 0;
    let report: string | undefined;
    const writeReport = (): void => {
      try {
        report = finish();
      } catch (e) {
        // A report that cannot be written (disk full, permissions) must not
        // turn into an uncaught crash with the publish decision unknown.
        deps.log(
          `✗ the run report could not be written: ${e instanceof Error ? e.message : String(e)}`,
        );
        if (rec.exitCode === 0) rec.exitCode = 4;
        if (rec.publish?.decision === "go")
          rec.publish = {
            decision: "held",
            heldBecause: ["the run report could not be written"],
          };
      }
    };
    // Written BEFORE the publish too, so a publish that hangs or dies still
    // leaves this run's report on disk.
    writeReport();
    let publishExit: number | undefined;
    if (opt.publish && rec.publish.decision === "go") {
      deps.log("── publish");
      let publishReport: string | undefined;
      try {
        const r = await deps.publish({ session });
        if (typeof r === "number") publishExit = r;
        else {
          publishExit = r.exitCode;
          publishReport = r.report;
        }
      } catch (e) {
        publishExit = 2;
        rec.findings.push(
          `publish runner crashed: ${e instanceof Error ? (e.stack ?? e.message).split("\n").slice(0, 6).join(" | ") : String(e)}`,
        );
      }
      // The ingest report is what a reader opens first: it must say what the
      // publish did, not tell them to run a publish that already ran.
      if (publishExit !== 0 && rec.exitCode === 0) rec.exitCode = 4;
      rec.published = {
        exitCode: publishExit,
        report: publishReport ? path.relative(REPO, publishReport) : undefined,
      };
      deps.log(
        `${publishExit === 0 ? "✓" : "✗"} publish exited ${publishExit}${publishReport ? ` — report ${path.relative(REPO, publishReport)}` : ""}`,
      );
      writeReport();
    } else if (opt.publish && rec.publish.decision === "held")
      deps.log(`publish held: ${heldBecause.join("; ")}`);
    // ONE report commit, after the publish (if any), still under the lock.
    if (!opt.noCommit) {
      let c: CommitResult;
      try {
        let pruned: string[] = [];
        try {
          pruned = deps.pruneTrackedRuns?.() ?? [];
        } catch (e) {
          deps.log(
            `old run folders not pruned: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        c = deps.commit(
          `watch: run report ${session}${publishExit !== undefined ? ` (publish exit ${publishExit})` : ""}`,
          [
            path.relative(REPO, runDir(session)),
            PENDING_FILE,
            "state/perf/process-watch-report.jsonl",
            ...pruned,
          ],
          [],
        );
      } catch (e) {
        c = {
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        };
      }
      if (c.status === "failed") {
        deps.log(`report commit failed: ${c.error}`);
        if (rec.exitCode === 0) rec.exitCode = 4;
      }
    }
    const exitCode =
      rec.exitCode !== 0
        ? rec.exitCode
        : publishExit !== undefined && publishExit !== 0
          ? 4
          : 0;
    return { exitCode, plan: thePlan, record: rec, report, publishExit };
  } finally {
    lock.release();
  }
};
