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
}

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
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, () => {
      if (interrupted) process.exit(130);
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
        : classify({ exitCode: code, timedOut, tail: tailText });
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
    ctx.perfDir,
  );

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
    ctx.perfDir,
  );
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

/** Run a step; a `chain` step runs link by link, stopping at the first
 *  failure exactly as `&&` would, one log and one perf row per link. */
export const runStepOrChain = async (
  spec: StepSpec & { kind?: "command" | "chain" },
  ctx: RunContext,
  scripts: Record<string, string>,
): Promise<StepOutcome[]> => {
  const links = spec.kind === "chain" ? expandChain(spec.run, scripts) : null;
  if (!links) return [await runStep(spec, ctx)];
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
    const o = await runStep(
      { ...spec, id, run: link, timeoutMin: leftMin },
      ctx,
      spec.id,
    );
    out.push(o);
    if (o.status !== "ok") break;
  }
  return out;
};
