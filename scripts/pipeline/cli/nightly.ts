// pnpm run pipeline:nightly — the whole unattended chain:
//
//   preflight (doctor) → watcher → ingest → publish (only when the ingest's
//   publish gate passes)
//
// It STOPS rather than continues when something critical happens:
//   - preflight: local Postgres down, git mid-rebase/merge or off main, or
//     too little free disk — nothing runs (exit 3);
//   - the watcher itself crashes or times out — nothing is ingested
//     (exit 5): planning on half-written watcher state would ingest a guess;
//   - mid-ingest, a step failing for an environment reason (local Postgres
//     gone, disk full, db auth) aborts the remaining handlers
//     (ingest.ts ABORT_CLASSES) and holds the publish;
//   - any handler failure holds the publish.
// Per-source watcher errors are NOT critical: they are reported (and a
// standing streak is flagged) and the ingest runs on what the watcher found.
//
//   pnpm run pipeline:nightly                 # the full chain
//   pnpm run pipeline:nightly --no-publish    # stop after the ingest commit
//
// Monitoring: every line below, and every step's start/end, goes to
// logs/pipeline/<session>/run.log (tail -f it) and status.json beside it;
// logs/pipeline/LATEST names the current session. ONE report covers the
// whole chain: state/pipeline/runs/<session>/report.md, written on every
// exit path — preflight refusal, watcher crash, runner crash included.
//
// Exit: 0 clean (or degraded: operator/agent items only) · 1 a handler or
// post-step failed · 2 the runner itself crashed · 3 another run holds the
// lock, or preflight refused · 4 ingest ok but the publish was held or
// failed · 5 the watcher failed · 130 interrupted during the watcher.
// Every exit writes the report EXCEPT two: refused by the lock (exit 3, the
// holder's run is the one to read) and a second Ctrl-C (exits at once).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { newSessionId } from "../../perf/perf_log";
import type { JsonReport } from "../../watch/report";
import {
  preflightBlockers,
  publishWarnings,
  renderDoctor,
  runDoctor,
  type DoctorResult,
} from "../doctor";
import { isInterrupted, runStep } from "../exec/executor";
import { monitorFor } from "../exec/monitor";
import { runIngest } from "../ingest";
import { realIngestDeps } from "../ingest_wiring";
import { acquireLock, LockHeldError } from "../lock";
import { medianIndex } from "../report/finalize";
import { logDir, runDir, type RunRecord } from "../report/record";
import { REPO } from "../state";
import { watcherPreamble } from "../watch_health";

const args = process.argv.slice(2);
const unknown = args.filter((a) => a !== "--no-publish");
if (unknown.length) {
  console.error(
    `pipeline:nightly: unknown argument(s) ${unknown.join(" ")} — only --no-publish`,
  );
  process.exit(2);
}
const publish = !args.includes("--no-publish");

const scripts = (
  JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

const session = newSessionId();
// Created only once the lock is held: a run refused by the lock must not take
// over logs/pipeline/LATEST from the run that holds it.
let monitor: ReturnType<typeof monitorFor> | null = null;
const log = (l: string): void =>
  monitor ? monitor.line(l) : console.error(`pipeline:nightly: ${l}`);
const deps = realIngestDeps(scripts, log);
const rel = (p: string): string => path.relative(REPO, p);

/** A desktop notification with the verdict — best-effort, macOS only. */
const notify = (title: string, body: string): void => {
  if (process.platform !== "darwin") return;
  try {
    execFileSync(
      "osascript",
      [
        "-e",
        `display notification ${JSON.stringify(body.slice(0, 200))} with title ${JSON.stringify(title)}`,
      ],
      { stdio: "ignore", timeout: 5000 },
    );
  } catch {
    // No notification is not a failure.
  }
};

const EXIT_MEANING: Record<number, string> = {
  0: "clean",
  1: "a handler or post-step failed",
  2: "the runner crashed",
  3: "preflight refused (or the lock is held)",
  4: "ingest ok but the publish was held or failed",
  5: "the watcher failed",
  130: "interrupted",
};

const end = (code: number, report?: string): never => {
  const meaning = EXIT_MEANING[code] ?? "unknown";
  if (report) log(`Report: ${rel(report)}`);
  monitor?.close(`nightly finished — exit ${code} (${meaning})`);
  notify(
    `Pipeline nightly: ${code === 0 ? "ok" : `exit ${code}`}`,
    `${meaning}${report ? ` — ${rel(report)}` : ""}`,
  );
  process.exit(code);
};

/** A report for a run that stopped before the ingest started, committed so
 *  the next reader finds it — never the previous session's. */
const stoppedEarly = (
  code: number,
  units: RunRecord["units"],
  findings: string[],
  doctor: DoctorResult | null,
  /** False when git itself is why the run stopped (mid-rebase, off main):
   *  committing there is exactly what the refusal prevents. The report is
   *  still written; it just stays uncommitted. */
  commit = true,
): never => {
  const rec: RunRecord = {
    schema: 1,
    session,
    kind: "ingest",
    startedAt,
    endedAt: new Date().toISOString(),
    git: { shaStart: deps.head(), shaEnd: deps.head() },
    env: doctor
      ? Object.fromEntries(
          doctor.checks.map((c) => [c.id, { ok: c.ok, detail: c.detail }]),
        )
      : {},
    units,
    needsOperator: [],
    needsAgent: [],
    findings,
    publish: { decision: "n/a", heldBecause: [] },
    exitCode: code,
  };
  let report: string | undefined;
  try {
    report = deps.finalize(rec);
    if (!commit)
      log(
        `report left uncommitted (git is why the run stopped): ${rel(report)}`,
      );
    else
      deps.commit(
        `watch: run report ${session} (stopped early, exit ${code})`,
        [rel(runDir(session))],
        [],
      );
  } catch (e) {
    log(
      `✗ could not write the report: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return end(code, report);
};

const startedAt = new Date().toISOString();
console.log(
  `pipeline:nightly ${session} — live: tail -f ${rel(logDir(session))}/run.log`,
);

const main = async (): Promise<void> => {
  // Held across the watcher too: a second nightly started while this one's
  // watcher runs must not plan on half-written watcher state.
  let held: ReturnType<typeof acquireLock>;
  try {
    held = acquireLock(session);
  } catch (e) {
    if (e instanceof LockHeldError) {
      log(`✗ ${e.message}`);
      return end(3);
    }
    throw e;
  }
  process.once("exit", () => held.release());
  monitor = monitorFor(session, logDir(session));
  const m = monitor;
  log(`── nightly ${session}${publish ? "" : " (--no-publish)"}`);

  // ---- preflight
  m.setPhase("preflight");
  const doctor = await runDoctor();
  for (const l of renderDoctor(doctor).trim().split("\n")) log(`  ${l}`);
  const blockers = preflightBlockers(doctor);
  if (blockers.length) {
    for (const b of blockers) log(`✗ preflight: ${b}`);
    return stoppedEarly(
      3,
      [
        {
          id: "preflight",
          status: "failed",
          why: `refused to start: ${blockers.join("; ")}`,
          steps: [],
          gates: [],
        },
      ],
      blockers.map((b) => `preflight refused: ${b}`),
      doctor,
      !blockers.some((b) => b.startsWith("git:")),
    );
  }
  const pubWarn = publish ? publishWarnings(doctor) : [];
  for (const w of pubWarn)
    log(
      `! publish will not complete unless fixed before the ingest ends: ${w}`,
    );

  // ---- watcher
  m.setPhase("watch");
  let seq = 0;
  const watchStarted = Date.now();
  const watch = await runStep(
    {
      id: "watch",
      run: "pnpm run watch",
      phase: "plan",
      timeoutMin: 120,
      db: "inherit",
    },
    {
      perfRun: "process-watch-report",
      session,
      logDir: logDir(session),
      nextSeq: () => ++seq,
      medianMs: medianIndex("process-watch-report", session),
    },
  );
  let json: JsonReport | null = null;
  try {
    json = JSON.parse(
      fs.readFileSync(path.join(REPO, "data-reports/latest.json"), "utf8"),
    ) as JsonReport;
  } catch {
    json = null;
  }
  const pre = watcherPreamble(watch, json, watchStarted);
  for (const f of pre.findings) log(`  ${f}`);
  const findings = [
    ...pubWarn.map((w) => `publish prerequisite missing at start: ${w}`),
    ...pre.findings,
  ];
  const interrupted = isInterrupted();
  if (interrupted) {
    log(`■ ${interrupted} during the watcher — nothing ingested`);
    return stoppedEarly(
      130,
      [
        ...pre.units.map((u) => ({
          ...u,
          status: "skipped" as const,
          why: `interrupted by ${interrupted}`,
        })),
      ],
      [...findings, `interrupted by ${interrupted} during the watcher`],
      doctor,
    );
  }
  if (watch.status !== "ok") {
    log(
      `✗ the watcher ${watch.status} (${watch.failure?.class}: ${watch.firstError ?? "no output"}) — nothing ingested; log ${watch.log}`,
    );
    return stoppedEarly(5, pre.units, findings, doctor);
  }

  // ---- ingest (+ publish)
  m.setPhase("ingest");
  const out = await runIngest(deps, {
    session,
    publish,
    preamble: { units: pre.units, findings },
  });
  return end(out.exitCode, out.report);
};

try {
  await main();
} catch (e) {
  const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
  if (e instanceof LockHeldError) end(3);
  monitor ??= monitorFor(session, logDir(session));
  log(`✗ runner crashed: ${msg.split("\n").slice(0, 6).join(" | ")}`);
  stoppedEarly(
    2,
    [
      {
        id: "runner",
        status: "failed",
        why: msg.split("\n")[0],
        steps: [],
        gates: [],
      },
    ],
    [`runner crashed: ${msg.split("\n").slice(0, 6).join(" | ")}`],
    null,
  );
}
