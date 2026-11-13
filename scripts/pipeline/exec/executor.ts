// Run one step: spawn it, tee its output to a log, enforce its timeout, pin
// its database, read its result file, classify a failure and append the perf
// row. Plan: docs/plans/watch-pipeline-scripts-v1.md §2.3.
//
// Every command either runner executes goes through runStep(), so a step can
// never be "run without the wrapper" — the failure mode the prose runbooks
// warned about, where a step that failed under the perf wrapper got re-run
// bare and silently stopped being measured.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { splitChain, stepName } from "../../perf/chain";
import { appendStep, type PerfStatus } from "../../perf/perf_log";
import { LOCAL_DATABASE_URL } from "../../db/lib/pg";
import { redact } from "../report/redact";
import { REPO } from "../state";
import { classify, firstErrorLine, type Classification } from "./classify";
import { monitorFor } from "./monitor";
import { readResult, RESULT_ENV, type StepResult } from "./result";

/** Which database a step may see. `local` pins the docker Postgres whatever
 *  the shell exported; `cloud` removes DATABASE_URL so the `:cloud` package
 *  script's own inline URL is the only one; `inherit` leaves it alone. */
export type DbPin = "local" | "cloud" | "inherit";

export interface StepSpec {
  /** Stable label — the perf `step`. */
  id: string;
  /** The exact command line. */
  run: string;
  phase: string;
  timeoutMin: number;
  /** Exit codes that count as success (a verifier's finding). */
  okExit?: readonly number[];
  db: DbPin;
}

export interface RunContext {
  /** The perf trace this run appends to. */
  perfRun: string;
  session: string;
  /** Directory for this session's logs. */
  logDir: string;
  /** Monotonic step counter shared by the whole run. */
  nextSeq: () => number;
  /** Where to write perf rows; defaults to state/perf. Tests pass a tmpdir. */
  perfDir?: string;
  /** Extra env for every step (tests). */
  env?: NodeJS.ProcessEnv;
  /** Lines of output kept for classification and the report. */
  tailLines?: number;
  /** A step's usual duration (median of earlier ok runs), for the live
   *  monitor's "usually Ns" and its over-2× warning. */
  medianMs?: (stepId: string) => number | undefined;
}

/** Where a step's perf row goes. Under a test runner the real trace is off
 *  limits: a test that forgets `perfDir` would append fake sessions to the
 *  committed state/perf/*.jsonl — which happened once, and was only noticed
 *  because the file showed up modified. */
const perfDirOf = (ctx: RunContext): string | undefined => {
  if (!ctx.perfDir && process.env.VITEST)
    throw new Error(
      "executor: running under a test without ctx.perfDir would write the real state/perf trace",
    );
  return ctx.perfDir;
};

export type StepStatus = "ok" | "error" | "timeout" | "skipped";

export interface StepOutcome {
  seq: number;
  id: string;
  command: string;
  phase: string;
  status: StepStatus;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  durationMs: number;
  /** Repo-relative path of the full log. */
  log: string;
  /** Last lines of combined output. */
  tail: string;
  firstError?: string;
  result?: StepResult;
  resultError?: string;
  failure?: Classification;
  /** Set for a link of an expanded `&&` chain. */
  chainOf?: string;
}

const DEFAULT_TAIL = 120;
const KILL_GRACE_MS = 10_000;
/** After the shell exits, how long to wait for its pipes to close. */
const PIPE_GRACE_MS = 2_000;

const slug = (s: string): string =>
  s
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "step";

const stamp = (): string => new Date().toISOString().slice(11, 23);

export const pinnedEnv = (
  base: NodeJS.ProcessEnv,
  db: DbPin,
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...base };
  // A chain link is a bare `tsx …`, which only resolves through the repo's
  // node_modules/.bin — the PATH `pnpm run` would have given it.
  env.PATH = `${path.join(REPO, "node_modules/.bin")}${path.delimiter}${base.PATH ?? ""}`;
  const pgpass = path.join(REPO, ".pgpass");
  if (fs.existsSync(pgpass)) env.PGPASSFILE = pgpass;
  if (db === "local") env.DATABASE_URL = LOCAL_DATABASE_URL;
  if (db === "cloud") delete env.DATABASE_URL;
  return env;
};

/** Keep the last N complete lines without holding all of them. */
class Tail {
  private lines: string[] = [];
  constructor(private readonly max: number) {}
  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.shift();
  }
  text(): string {
    return this.lines.join("\n");
  }
}

/** One stream's bytes → complete lines. A decoder per stream keeps a
 *  multi-byte character split across two chunks intact, and a partial line
 *  per stream keeps stdout and stderr fragments from merging. */
export class LineSplitter {
  private readonly decoder = new StringDecoder("utf8");
  private partial = "";
  constructor(private readonly onLine: (line: string) => void) {}
  write(buf: Buffer): void {
    const parts = (this.partial + this.decoder.write(buf)).split("\n");
    this.partial = parts.pop() ?? "";
    for (const p of parts) this.onLine(p);
  }
  end(): void {
    const rest = this.partial + this.decoder.end();
    this.partial = "";
    if (rest) this.onLine(rest);
  }
}

// ---------------------------------------------------------------- signals
//
// Steps run in their own process group (so a timeout can kill the whole
// tree), which also means Ctrl-C on the runner never reaches them. The runner
// forwards the signal itself: every live group gets SIGTERM, the current step
// records itself as interrupted, and runners stop before the next step. A
// second signal exits at once.

const liveGroups = new Set<number>();
let interrupted: NodeJS.Signals | null = null;
let signalsInstalled = false;

export const isInterrupted = (): NodeJS.Signals | null => interrupted;

const installSignalForwarding = (): void => {
  if (signalsInstalled) return;
  signalsInstalled = true;
  // After SIGHUP the terminal is gone and a write to it raises EIO as an
  // uncaught 'error' — which would kill the runner before its report.
  process.stdout.on("error", () => {});
  process.stderr.on("error", () => {});
  // SIGHUP too: a closed terminal must stop the steps, not orphan them —
  // they run in their own process groups, so nothing else would.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(sig, () => {
      if (interrupted) {
        // Second signal: do not leave detached step groups running behind a
        // runner that is gone (a :cloud loader would keep writing).
        for (const pgid of liveGroups)
          try {
            process.kill(-pgid, "SIGKILL");
          } catch {
            // Already gone.
          }
        process.stderr.write(
          `\npipeline: second ${sig} — killed ${liveGroups.size} step group(s); exiting without a report\n`,
        );
        process.exit(130);
      }
      interrupted = sig;
      process.stderr.write(
        `\npipeline: ${sig} — stopping ${liveGroups.size} running step(s); send it again to exit at once\n`,
      );
      for (const pgid of liveGroups)
        try {
          process.kill(-pgid, "SIGTERM");
        } catch {
          // Already gone.
        }
    });
};

export const runStep = async (
  spec: StepSpec,
  ctx: RunContext,
  chainOf?: string,
): Promise<StepOutcome> => {
  perfDirOf(ctx); // refuse BEFORE spawning anything, not after
  const seq = ctx.nextSeq();
  fs.mkdirSync(ctx.logDir, { recursive: true });
  const base = `${String(seq).padStart(3, "0")}-${slug(spec.id)}`;
  const logFile = path.join(ctx.logDir, `${base}.log`);
  const resultFile = path.join(ctx.logDir, `${base}.result.json`);
  const env = pinnedEnv({ ...process.env, ...ctx.env }, spec.db);
  env[RESULT_ENV] = resultFile;

  const log = fs.createWriteStream(logFile);
  log.write(
    [
      `# step     ${spec.id}${chainOf ? ` (link of ${chainOf})` : ""}`,
      `# command  ${spec.run}`,
      `# cwd      ${REPO}`,
      `# db pin   ${spec.db}${spec.db === "local" ? ` (${LOCAL_DATABASE_URL.replace(/:[^:@/]+@/, ":***@")})` : ""}`,
      `# timeout  ${spec.timeoutMin} min`,
      `# started  ${new Date().toISOString()}`,
      "",
    ].join("\n") + "\n",
  );

  const tail = new Tail(ctx.tailLines ?? DEFAULT_TAIL);
  const startedAt = new Date();
  const monitor = monitorFor(ctx.session, ctx.logDir);
  monitor.stepStart({
    seq,
    id: spec.id,
    command: spec.run,
    log: path.relative(REPO, logFile),
    startedAt: startedAt.toISOString(),
    medianMs: ctx.medianMs?.(spec.id),
  });
  let timedOut = false;
  installSignalForwarding();

  const { code, signal } = await new Promise<{
    code: number | null;
    signal: string | null;
  }>((resolve) => {
    // detached: the step gets its own process group, so a timeout kills the
    // whole tree (pnpm → tsx → node), not just the shell.
    const child = spawn("/bin/bash", ["-c", spec.run], {
      cwd: REPO,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid) liveGroups.add(child.pid);
    const splitter = (stream: "out" | "err"): LineSplitter =>
      new LineSplitter((line) => {
        tail.push(line);
        log.write(`${stamp()} ${stream === "err" ? "!" : " "} ${line}\n`);
      });
    const out = splitter("out");
    const err = splitter("err");
    child.stdout.on("data", (b: Buffer) => out.write(b));
    child.stderr.on("data", (b: Buffer) => err.write(b));

    const kill = (sig: NodeJS.Signals): void => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch {
        // Already gone.
      }
    };
    let settled = false;
    const finish = (c: number | null, s: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.pid) liveGroups.delete(child.pid);
      out.end();
      err.end();
      resolve({ code: c, signal: s });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      log.write(
        `${stamp()} # TIMEOUT after ${spec.timeoutMin} min — SIGTERM to the process group\n`,
      );
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), KILL_GRACE_MS).unref();
    }, spec.timeoutMin * 60_000);
    child.on("error", (e) => {
      tail.push(`spawn error: ${e.message}`);
      finish(127, null);
    });
    // `close` waits for the pipes too. A descendant that left the process
    // group (setsid, a daemonised helper) can hold them open for ever, so on
    // `exit` give the pipes a short grace, then stop waiting for them.
    child.on("exit", (c, s) => {
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(c, s);
      }, PIPE_GRACE_MS).unref();
    });
    child.on("close", (c, s) => finish(c, s));
  });

  const durationMs = Date.now() - startedAt.getTime();
  const okExit = new Set([0, ...(spec.okExit ?? [])]);
  const wasInterrupted = interrupted !== null;
  const status: StepStatus = timedOut
    ? "timeout"
    : !wasInterrupted && code !== null && okExit.has(code)
      ? "ok"
      : "error";

  let result: StepResult | undefined;
  let resultError: string | undefined;
  try {
    const read = readResult(resultFile);
    result = read?.result;
    if (read?.problems.length)
      resultError = `${RESULT_ENV}: ${read.problems.join("; ")}`;
  } catch (e) {
    resultError = `unreadable ${RESULT_ENV}: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Everything below the raw log is redacted: it reaches committed files.
  const tailText = redact(tail.text());
  const failure =
    status === "ok"
      ? undefined
      : wasInterrupted
        ? {
            class: "interrupted" as const,
            retryable: true,
            holdsPublish: true,
            hint: `The runner received ${interrupted} and stopped this step — re-run when ready.`,
          }
        : classify({ exitCode: code, timedOut, tail: tailText, db: spec.db });
  log.write(
    `\n# ended    ${new Date().toISOString()} · ${status} · exit ${code ?? `signal ${signal}`} · ${durationMs} ms\n`,
  );
  await new Promise<void>((r) => log.end(r));

  const perfStatus: PerfStatus = status === "ok" ? "ok" : "error";
  appendStep(
    {
      ts: new Date().toISOString(),
      run: ctx.perfRun,
      session: ctx.session,
      seq,
      step: spec.id,
      phase: spec.phase,
      command: spec.run,
      startedAt: startedAt.toISOString(),
      durationMs,
      status: perfStatus,
      exitCode: code ?? undefined,
      notes:
        status === "ok"
          ? result?.summary
          : `${failure?.class}${timedOut ? " (timeout)" : ""}: ${firstErrorLine(tailText) ?? ""}`.slice(
              0,
              300,
            ),
    },
    perfDirOf(ctx),
  );

  monitor.stepEnd({
    seq,
    id: spec.id,
    status,
    exitCode: code,
    durationMs,
    log: path.relative(REPO, logFile),
    firstError: status === "ok" ? undefined : firstErrorLine(tailText),
  });

  return {
    seq,
    id: spec.id,
    command: spec.run,
    phase: spec.phase,
    status,
    exitCode: code,
    signal,
    startedAt: startedAt.toISOString(),
    durationMs,
    log: path.relative(REPO, logFile),
    tail: tailText,
    firstError: status === "ok" ? undefined : firstErrorLine(tailText),
    result,
    resultError,
    failure,
    chainOf,
  };
};

/** Record a step that did not run (refused, planned-skip, held) — a skipped
 *  command and an unnoticed one must not look identical in the trace. */
export const recordSkip = (
  spec: Pick<StepSpec, "id" | "run" | "phase">,
  why: string,
  ctx: RunContext,
): StepOutcome => {
  perfDirOf(ctx);
  const seq = ctx.nextSeq();
  const now = new Date().toISOString();
  appendStep(
    {
      ts: now,
      run: ctx.perfRun,
      session: ctx.session,
      seq,
      step: spec.id,
      phase: spec.phase,
      command: spec.run,
      startedAt: now,
      durationMs: 0,
      status: "skipped",
      notes: why.slice(0, 300),
    },
    perfDirOf(ctx),
  );
  monitorFor(ctx.session, ctx.logDir).stepEnd({
    seq,
    id: spec.id,
    status: "skipped",
    exitCode: null,
    durationMs: 0,
    log: "",
    firstError: why,
  });
  return {
    seq,
    id: spec.id,
    command: spec.run,
    phase: spec.phase,
    status: "skipped",
    exitCode: null,
    signal: null,
    startedAt: now,
    durationMs: 0,
    log: "",
    tail: "",
    firstError: why,
  };
};

/** The `&&` links of a `pnpm run <script>` whose package.json body is a chain,
 *  or null when the command is not a bare chain script. A command WITH extra
 *  arguments is never expanded: the arguments belong to the last link only,
 *  and guessing that would change what runs. */
export const expandChain = (
  run: string,
  scripts: Record<string, string>,
): string[] | null => {
  const m = run.match(/^pnpm run ([^\s]+)$/);
  if (!m) return null;
  const body = scripts[m[1]];
  if (!body) return null;
  const links = splitChain(body);
  return links.length > 1 ? links : null;
};

/** Test files a vitest run reported red: ` FAIL  |node| scripts/…test.ts > …`. */
export const redTestFiles = (tail: string): string[] => [
  ...new Set(
    [...tail.matchAll(/^\s*FAIL\s+(?:\|[^|]+\|\s+)?(\S+\.test\.tsx?)\b/gm)].map(
      (m) => m[1],
    ),
  ),
];

/** A step log's output lines without the runner's own framing: the `# …`
 *  header/footer lines and the `HH:MM:SS.mmm [ !] ` prefix on every line. */
export const logBody = (log: string): string =>
  log
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .map((l) => l.replace(/^\d\d:\d\d:\d\d\.\d{3} [ !] /, ""))
    .join("\n");

/** Promotion is safe only when vitest's own summary proves the parsed red
 *  set is ALL that failed: its failed-file count equals the files found,
 *  every file is accounted for (failed + passed + skipped = total), and no
 *  error happened outside a test file (Unhandled Errors, a worker that died
 *  and left a file unrun). Anything else stays failed. */
export const redSetIsComplete = (output: string, parsed: number): boolean => {
  if (/Unhandled Errors?|^\s*Errors\s+\d+ errors?/m.test(output)) return false;
  const m = output.match(
    /Test Files\s+(\d+) failed(?:\s*\|\s*(\d+) passed)?(?:\s*\|\s*(\d+) skipped)?\s*\((\d+)\)/,
  );
  if (!m) return false;
  const [failed, passed, skipped, total] = [
    m[1],
    m[2] ?? "0",
    m[3] ?? "0",
    m[4],
  ].map(Number);
  return failed === parsed && failed + passed + skipped === total;
};

/** At most this many red files are re-run alone; more than that is not
 *  flakiness under load, it is a broken suite. */
export const MAX_SOLO_RERUNS = 10;

/** `pnpm run test:data` — and any vitest step — is flaky under load: a data
 *  gate that times out beside 15 concurrent workers passes alone (the repo's
 *  standing rule: re-run a red file alone before believing it). A test step
 *  that failed only on files that then pass solo counts as passed, with the
 *  files named as a warning; anything else stays failed. */
export const rerunRedTestsSolo = async (
  o: StepOutcome,
  spec: StepSpec,
  ctx: RunContext,
  soloCommand: (file: string) => string = (f) => `pnpm exec vitest run ${f}`,
): Promise<StepOutcome[]> => {
  const isTest = /\btest:data\b|\bvitest run\b|\btest:unit\b/.test(spec.run);
  if (o.status !== "error" || !isTest || o.failure?.class !== "test-failed")
    return [o];
  // The FULL log, not the tail: with several failures the earlier FAIL
  // headers scroll out of the last 120 lines, and a broken file must never
  // be dropped from the re-run set because it printed early.
  let output = o.tail;
  try {
    if (o.log)
      output = logBody(fs.readFileSync(path.resolve(REPO, o.log), "utf8"));
  } catch {
    output = o.tail;
  }
  const files = redTestFiles(output);
  if (!files.length || files.length > MAX_SOLO_RERUNS) return [o];
  if (!redSetIsComplete(output, files.length)) return [o];
  const reruns: StepOutcome[] = [];
  for (const f of files) {
    if (isInterrupted()) break;
    reruns.push(
      await runStep(
        {
          ...spec,
          id: `${spec.id} › solo ${f}`,
          run: soloCommand(f),
          okExit: [],
        },
        ctx,
        o.chainOf,
      ),
    );
  }
  if (reruns.length === files.length && reruns.every((r) => r.status === "ok"))
    return [
      {
        ...o,
        status: "ok",
        failure: undefined,
        result: {
          ...o.result,
          warnings: [
            ...(o.result?.warnings ?? []),
            `red under load, green alone: ${files.join(", ")}`,
          ],
        },
      },
      ...reruns,
    ];
  return [o, ...reruns];
};

/** Run a step; a `chain` step runs link by link, stopping at the first
 *  failure exactly as `&&` would, one log and one perf row per link. */
export const runStepOrChain = async (
  spec: StepSpec & { kind?: "command" | "chain" },
  ctx: RunContext,
  scripts: Record<string, string>,
  soloCommand?: (file: string) => string,
): Promise<StepOutcome[]> => {
  const links = spec.kind === "chain" ? expandChain(spec.run, scripts) : null;
  if (!links)
    return rerunRedTestsSolo(await runStep(spec, ctx), spec, ctx, soloCommand);
  // The step's timeout is a budget for the WHOLE chain: each link gets what is
  // left of it, so an N-link chain cannot run N times its budget.
  const deadline = Date.now() + spec.timeoutMin * 60_000;
  const out: StepOutcome[] = [];
  for (const link of links) {
    const id = `${spec.id} › ${stepName(link)}`;
    if (isInterrupted()) {
      out.push(
        recordSkip(
          { id, run: link, phase: spec.phase },
          "runner interrupted",
          ctx,
        ),
      );
      break;
    }
    const leftMin = (deadline - Date.now()) / 60_000;
    if (leftMin <= 0) {
      const skipped = recordSkip(
        { id, run: link, phase: spec.phase },
        `chain ${spec.id} used its ${spec.timeoutMin} min budget before this link`,
        ctx,
      );
      out.push({
        ...skipped,
        status: "timeout",
        failure: classify({ exitCode: null, timedOut: true, tail: "" }),
        chainOf: spec.id,
      });
      break;
    }
    const linkSpec = { ...spec, id, run: link, timeoutMin: leftMin };
    const got = await rerunRedTestsSolo(
      await runStep(linkSpec, ctx, spec.id),
      linkSpec,
      ctx,
      soloCommand,
    );
    out.push(...got);
    if (got[0].status !== "ok") break;
  }
  return out;
};
