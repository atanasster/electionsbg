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
import { REPO } from "./state";

export const PERF_RUN = "process-watch-report";
export const CHANGELOG_FILE = "data/data-changes.json";
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
  /** Put a file back as it was (null = it did not exist). */
  restoreFile: (rel: string, text: string | null) => void;
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
  filesInCommit: (sha: string) => string[];
  generatedPaths: (files: readonly string[]) => string[];
  writeManifest: (
    m: Partial<UploadManifest> & { session: string },
  ) => WriteResult;
  /** Top-level data/ entries matching `re` modified at or after `sinceMs`. */
  dataDirsTouched: (re: RegExp, sinceMs: number) => string[];
  snapshotBaselines: (gates: readonly Gate[]) => Map<string, unknown>;
  gateCtx: (output: string, baselines: Map<string, unknown>) => GateCtx;
  lock: (session: string) => {
    release: () => void;
    tookOver?: { pid: number; session: string };
  };
  finalize: (rec: RunRecord) => string;
  /** Run the publish; returns its exit code. */
  publish: () => Promise<number>;
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
  /** Do not commit (local experiments). Holds the publish. */
  noCommit?: boolean;
  perfDir?: string;
}

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
}

export const runIngest = async (
  deps: IngestDeps,
  opt: IngestOptions = {},
): Promise<IngestOutcome> => {
  const doctor = await deps.doctor();
  const state = deps.loadState();
  const thePlan = plan({
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
  if (opt.dryRun) return { exitCode: 0, plan: thePlan };

  const session = opt.session ?? newSessionId();
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
    units: [],
    needsOperator: [],
    needsAgent: [],
    findings: [
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

  let seq = 0;
  const ctx: RunContext = {
    perfRun: PERF_RUN,
    session,
    logDir: logDir(session),
    nextSeq: () => ++seq,
    perfDir: opt.perfDir,
  };
  const unmet = (needs: readonly Need[]): Need[] =>
    needs.filter((n) => doctor.unmet.has(n));

  const succeeded: Succeeded[] = [];
  /** handler id → its unit's final status in THIS run. */
  const outcome = new Map<string, UnitRecord["status"]>();
  const heldBecause: string[] = [];
  /** Files a failed handler wrote; never committed by this run. */
  const leftovers = new Set<string>();

  const manifestFor = (
    commit?: string,
    posts: PostStep[] = [],
  ): Partial<UploadManifest> & { session: string } => ({
    session,
    commit,
    skills: succeeded.map((s) => s.handler.skill ?? s.handler.id),
    paths: [
      ...new Set([
        ...succeeded.flatMap((s) => [...s.entry.paths, ...s.dirs]),
        ...posts.flatMap((p) => p.publish?.paths ?? []),
        ...(commit ? deps.generatedPaths(deps.filesInCommit(commit)) : []),
      ]),
    ],
    cloudCommands: orderCloud([
      ...succeeded.flatMap((s) => s.entry.cloud),
      ...posts.flatMap((p) => p.publish?.cloud ?? []),
    ]),
  });
  const writeManifest = (
    m: Partial<UploadManifest> & { session: string },
  ): void => {
    if (!m.paths?.length && !m.cloudCommands?.length) return;
    const w = deps.writeManifest(m);
    if (!w.ok) {
      heldBecause.push(`upload manifest not written: ${w.error}`);
      rec.findings.push(`upload manifest not written: ${w.error}`);
    }
  };

  const finish = (): string => {
    rec.endedAt = new Date().toISOString();
    rec.git.shaEnd = deps.head();
    return deps.finalize(rec);
  };

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

        if (isInterrupted()) {
          settle("skipped", "runner interrupted");
          continue;
        }
        if (entry.status === "bootstrap") {
          if (entry.bootstrapAction === "seed") {
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
          if (entry.status === "nothing-to-run")
            rec.findings.push(`${h.id}: ${entry.why}`);
          continue;
        }
        // A prerequisite queued in this run must have COMPLETED — failed,
        // blocked, partial and delegated-to-agent all mean its output is the
        // previous vintage, and a stamped dependent would not re-queue when
        // the prerequisite finally runs.
        const notDone = (h.after ?? []).find(
          (a) => outcome.has(a) && outcome.get(a) !== "ok",
        );
        if (notDone) {
          settle(
            "blocked",
            `runs after ${notDone}, which did not complete in this run (${outcome.get(notDone)})`,
          );
          continue;
        }
        if (h.runner === "skill") {
          settle(
            "skipped",
            `delegated to the ${h.skill ?? h.id} runbook (not yet a script)`,
          );
          rec.needsAgent.push({
            unit: h.id,
            id: "run-runbook",
            instruction: `Run ${h.skill ?? h.id} for ${entry.flipped.join(", ")}. Planned steps: ${entry.steps
              .filter((s) => s.status === "run")
              .map((s) => s.run)
              .join(" → ")}`,
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
            okExit: ps.okExit,
            db: "local",
            kind: ps.kind,
          };
          const missing = def ? unmet(stepNeeds(h, def)) : [];
          if (broke || missing.length || isInterrupted()) {
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
          }
        }
        unit.steps = outs.map((o) => toStepRecord(o));
        const wrote = changedBetween(
          outputsBefore,
          deps.outputSignature(h.outputs ?? [], headBefore),
        );
        unit.filesChanged = wrote;

        if (!broke) {
          const output = outs.map((o) => o.tail).join("\n");
          unit.gates = runGates(
            h.gates ?? [],
            new Set(entry.flipped),
            deps.gateCtx(output, baselines),
          );
        }
        const gateFailed = unit.gates.some((g) => !g.ok);
        const interrupted = isInterrupted();
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
          continue;
        }

        unit.summary = summarize(outs);
        const partialWhy = !entry.stampable
          ? `${entry.deferred.join(", ")} deferred to an operator item`
          : needsSkipped.length
            ? `step(s) ${needsSkipped.join(", ")} skipped for an unmet need`
            : null;
        if (partialWhy) {
          settle("partial", `marker not stamped: ${partialWhy}`);
          unit.stamped = false;
          if (h.stamp === "self") deps.restoreFile(markerFile, markerBefore);
        } else {
          if (h.stamp !== "self")
            deps.stamp(entry.marker, unit.summary, startedAt);
          unit.stamped = true;
          settle("ok");
        }
        if (h.changelog === "orchestrator" && wrote.length)
          deps.appendChange({
            skill: h.skill ?? h.id,
            summary: unit.summary,
            source: entry.flipped
              .map((s) => deps.sourceLabel(s) ?? s)
              .join("; "),
          });
        for (const a of entry.agent) rec.needsAgent.push({ unit: h.id, ...a });
        const dirs = h.publish?.dirsMatching
          ? deps.dataDirsTouched(h.publish.dirsMatching, startedMs)
          : [];
        succeeded.push({ entry, handler: h, dirs });
        // Durable promise first: a stamped marker's work is on the manifest
        // before anything else can go wrong.
        writeManifest(manifestFor());
      }

      // ---- post-steps
      const posts: PostStep[] = succeeded.length
        ? selectPostSteps(
            succeeded.flatMap((s) => s.entry.followUps),
            new Set(succeeded.flatMap((s) => s.entry.flipped)),
            deps.postSteps,
          )
        : [];
      const postOk: PostStep[] = [];
      for (const p of posts) {
        const unit: UnitRecord = {
          id: `post:${p.id}`,
          status: "ok",
          steps: [],
          gates: [],
        };
        rec.units.push(unit);
        let broke: string | null = null;
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
          if (broke || missing.length || isInterrupted()) {
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
            if (missing.length && !broke) unit.status = "skipped";
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
        if (broke) {
          unit.status = "failed";
          unit.why = `${broke} failed`;
          heldBecause.push(`post-step ${p.id}: ${broke} failed`);
          for (const f of changedBetween(
            before,
            deps.outputSignature(p.outputs ?? [], headBefore),
          ))
            leftovers.add(f);
        } else if (unit.status === "ok") postOk.push(p);
      }

      // ---- commit
      const runFolder = path.relative(REPO, runDir(session));
      const commitPathspec = [
        ...new Set([
          ...succeeded.flatMap((s) => s.handler.outputs ?? []),
          ...postOk.flatMap((p) => p.outputs ?? []),
          ...BOOKKEEPING,
          runFolder,
        ]),
      ];
      let commitSha: string | undefined;
      if (opt.noCommit) {
        rec.findings.push("--no-commit: nothing committed");
        if (succeeded.length)
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
        } else if (c.status === "committed") commitSha = c.sha;
        // Nothing to commit can mean the auto-committer already committed
        // this run's files: HEAD then holds them, so it is the commit to name.
        else if (succeeded.length) commitSha = deps.head() ?? undefined;
      }

      // ---- manifest, now with the commit and the post-steps' work
      if (succeeded.length) writeManifest(manifestFor(commitSha, postOk));
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

    const interrupted = isInterrupted();
    if (interrupted) heldBecause.push(`interrupted by ${interrupted}`);
    const publishable = succeeded.some(
      (s) => s.entry.paths.length || s.entry.cloud.length || s.dirs.length,
    );
    rec.publish = !succeeded.length
      ? { decision: "n/a", heldBecause: [] }
      : heldBecause.length
        ? { decision: "held", heldBecause }
        : publishable ||
            rec.units.some((u) => u.id.startsWith("post:") && u.status === "ok")
          ? { decision: "go", heldBecause: [] }
          : { decision: "n/a", heldBecause: [] };
    const anyFailed = rec.units.some((u) => u.status === "failed");
    rec.exitCode = anyFailed ? 1 : rec.publish.decision === "held" ? 4 : 0;
    const report = finish();
    if (!opt.noCommit) {
      let c: CommitResult;
      try {
        c = deps.commit(
          `watch: run report ${session}`,
          [
            path.relative(REPO, runDir(session)),
            "state/upload/pending.json",
            "state/perf/process-watch-report.jsonl",
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
    let publishExit: number | undefined;
    if (opt.publish && rec.publish.decision === "go") {
      lock.release();
      publishExit = await deps.publish();
    } else if (opt.publish && rec.publish.decision === "held")
      deps.log(`publish held: ${heldBecause.join("; ")}`);
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
