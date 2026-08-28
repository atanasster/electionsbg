// CLI: time one orchestrator step and append it to the run's trace.
//
//   # wrap a command (exact timing, exit code propagated)
//   npm run perf:step -- run --run process-watch-report --session "$S" \
//     --step "myarea:alerts" --phase derive -- npm run myarea:alerts
//
//   # a verifier whose non-zero exit is a FINDING, not a crash
//   npm run perf:step -- run --run process-watch-report --session "$S" \
//     --step "db:check-cloud" --phase verify --ok-exit 1 -- npm run db:check-cloud
//
//   # record a step this process did not run (a Skill invocation, a manual
//   # download, an operator wait) — from a captured start time
//   npm run perf:step -- record --run process-watch-report --session "$S" \
//     --step "update-procurement" --phase ingest --started "$T0" --status ok
//
//   # mint a session id (once per orchestrator invocation)
//   npm run perf:step -- session
//
//   # read the trace back
//   npm run perf:report -- --run process-watch-report --last 5
//
// `run` is the mode to prefer: it measures the child process itself, so the
// number cannot drift from what actually happened. `record` exists because an
// agent-invoked Skill is not a shell command and would otherwise be a hole in
// the trace — an unmeasured step is indistinguishable from a fast one.

import { spawnSync } from "child_process";
import {
  appendStep,
  formatDuration,
  logPath,
  newSessionId,
  readSteps,
  summarizeSessions,
  summarizeSteps,
  type PerfStatus,
  type PerfStep,
} from "./perf_log";

const argv = process.argv.slice(2);

const die = (msg: string): never => {
  console.error(`perf: ${msg}`);
  process.exit(2);
};

/** Flags before a bare `--`; everything after it is the child command. */
const splitArgv = (args: string[]): { flags: string[]; cmd: string[] } => {
  const i = args.indexOf("--");
  return i === -1
    ? { flags: args, cmd: [] }
    : { flags: args.slice(0, i), cmd: args.slice(i + 1) };
};

const flagValue = (flags: string[], name: string): string | undefined => {
  const i = flags.indexOf(`--${name}`);
  if (i !== -1) return flags[i + 1];
  const inline = flags.find((f) => f.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
};

const hasFlag = (flags: string[], name: string): boolean =>
  flags.includes(`--${name}`);

const asStatus = (raw: string | undefined): PerfStatus => {
  if (!raw) return "ok";
  if (raw === "ok" || raw === "error" || raw === "skipped") return raw;
  return die(`--status must be ok|error|skipped, got ${raw}`);
};

/** Accepts an ISO stamp or epoch seconds/millis (`date +%s` is the easy one). */
const parseStart = (raw: string): number => {
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    // Epoch seconds until ~2286; anything larger is already millis.
    return n < 1e11 ? n * 1000 : n;
  }
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return die(`unparseable --started: ${raw}`);
  return t;
};

const commonRecord = (
  flags: string[],
): Pick<PerfStep, "run" | "session" | "seq" | "step" | "phase" | "notes"> => {
  const run = flagValue(flags, "run") ?? die("--run is required");
  const step = flagValue(flags, "step") ?? die("--step is required");
  const session =
    flagValue(flags, "session") ??
    die("--session is required (mint one with `perf:step session`)");
  const seqRaw = flagValue(flags, "seq");
  return {
    run,
    session,
    step,
    seq: seqRaw ? Number(seqRaw) : nextSeq(run, session),
    phase: flagValue(flags, "phase"),
    notes: flagValue(flags, "notes"),
  };
};

/** Auto-numbering so a caller never has to thread a counter through a shell. */
const nextSeq = (run: string, session: string): number =>
  readSteps(run).steps.filter((s) => s.session === session).length + 1;

const withBytes = (flags: string[], row: PerfStep): PerfStep => {
  const bytes = flagValue(flags, "bytes");
  return bytes ? { ...row, bytes: Number(bytes) } : row;
};

const emit = (row: PerfStep): void => {
  appendStep(row);
  const tail = row.status === "ok" ? "" : ` [${row.status}]`;
  console.log(`⏱  ${row.step} — ${formatDuration(row.durationMs)}${tail}`);
};

/**
 * Exit codes that count as a normal outcome for this step.
 *
 * The two `db:check-*` verifiers exit 1 BY DESIGN when they find drift — that
 * is their finding, not a crash. Recording it as `error` on every run would
 * make the trace's failure count meaningless, which is the one number a reader
 * scans for. The exit code is still propagated either way.
 */
const okExits = (flags: string[]): Set<number> => {
  const raw = flagValue(flags, "ok-exit");
  return new Set([0, ...(raw ? raw.split(",").map(Number) : [])]);
};

const cmdRun = (flags: string[], cmd: string[]): void => {
  if (cmd.length === 0)
    die("`run` needs a command after `--`, e.g. -- npm run db:refresh");
  const base = commonRecord(flags);
  const accepted = okExits(flags);
  const startedAt = new Date();
  const t0 = Date.now();
  // stdio inherit: the child's output is the operator's (and the agent's) only
  // view of what the step did. Capturing it here would swallow it.
  const res = spawnSync(cmd[0], cmd.slice(1), {
    stdio: "inherit",
    shell: false,
  });
  const durationMs = Date.now() - t0;
  const exitCode = res.status ?? (res.error ? 1 : 0);
  emit(
    withBytes(flags, {
      ...base,
      ts: new Date().toISOString(),
      startedAt: startedAt.toISOString(),
      durationMs,
      status: accepted.has(exitCode) ? "ok" : "error",
      exitCode,
      command: cmd.join(" "),
      notes: res.error
        ? `${base.notes ?? ""} ${res.error.message}`.trim()
        : base.notes,
    }),
  );
  // Propagate, so `perf:step run -- X && Y` keeps `&&` semantics.
  process.exit(exitCode);
};

const cmdRecord = (flags: string[]): void => {
  const base = commonRecord(flags);
  const status = asStatus(flagValue(flags, "status"));
  const startedRaw = flagValue(flags, "started");
  const secondsRaw = flagValue(flags, "seconds");
  const msRaw = flagValue(flags, "ms");
  let durationMs: number;
  let startedAt: string;
  const now = Date.now();
  if (msRaw !== undefined) {
    durationMs = Number(msRaw);
    startedAt = new Date(now - durationMs).toISOString();
  } else if (secondsRaw !== undefined) {
    durationMs = Math.round(Number(secondsRaw) * 1000);
    startedAt = new Date(now - durationMs).toISOString();
  } else if (startedRaw !== undefined) {
    const t0 = parseStart(startedRaw);
    durationMs = now - t0;
    startedAt = new Date(t0).toISOString();
  } else if (status === "skipped") {
    durationMs = 0;
    startedAt = new Date(now).toISOString();
  } else {
    return die("`record` needs one of --started / --seconds / --ms");
  }
  emit(
    withBytes(flags, {
      ...base,
      ts: new Date(now).toISOString(),
      startedAt,
      durationMs,
      status,
      command: flagValue(flags, "command"),
    }),
  );
};

const cmdReport = (flags: string[]): void => {
  const run = flagValue(flags, "run") ?? "process-watch-report";
  const last = Number(flagValue(flags, "last") ?? 5);
  const { steps, skippedLines } = readSteps(run);
  if (steps.length === 0) {
    console.log(`No trace yet at ${logPath(run)}`);
    return;
  }
  if (hasFlag(flags, "json")) {
    console.log(
      JSON.stringify(
        { sessions: summarizeSessions(steps), steps: summarizeSteps(steps) },
        null,
        2,
      ),
    );
    return;
  }
  const sessions = summarizeSessions(steps);
  console.log(
    `# ${run} — ${steps.length} steps across ${sessions.length} sessions`,
  );
  if (skippedLines)
    console.log(`  (${skippedLines} unparseable line(s) skipped)`);

  console.log(`\n## Last ${Math.min(last, sessions.length)} session(s)`);
  for (const s of sessions.slice(-last)) {
    const flags2 = [
      s.failures ? `${s.failures} failed` : null,
      s.skipped ? `${s.skipped} skipped` : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `\n${s.session}  ${s.startedAt}  ${formatDuration(s.totalMs)} of work in ${s.stepCount} steps${flags2 ? ` (${flags2})` : ""}`,
    );
    for (const step of s.slowest)
      console.log(
        `    ${formatDuration(step.durationMs).padStart(10)}  ${step.step}`,
      );
  }

  console.log(`\n## Cost by step (all sessions, ranked by total)`);
  const perStep = summarizeSteps(steps).slice(
    0,
    Number(flagValue(flags, "top") ?? 25),
  );
  console.log(
    `${"total".padStart(10)} ${"median".padStart(10)} ${"max".padStart(10)} ${"last".padStart(10)}  runs  step`,
  );
  for (const s of perStep)
    console.log(
      `${formatDuration(s.totalMs).padStart(10)} ${formatDuration(s.medianMs).padStart(10)} ` +
        `${formatDuration(s.maxMs).padStart(10)} ${formatDuration(s.lastMs).padStart(10)} ` +
        `${String(s.runs).padStart(5)}  ${s.step}${s.failures ? `  ⚠ ${s.failures} failure(s)` : ""}`,
    );
};

const sub = argv[0];
const { flags, cmd } = splitArgv(argv.slice(1));

switch (sub) {
  case "session":
    console.log(newSessionId());
    break;
  case "run":
    cmdRun(flags, cmd);
    break;
  case "record":
    cmdRecord(flags);
    break;
  case "report":
    cmdReport(flags);
    break;
  default:
    die(
      `unknown subcommand ${sub ?? "(none)"} — expected session | run | record | report`,
    );
}
