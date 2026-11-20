// Live monitoring for a pipeline run — what a person (or an agent) watching a
// run in progress reads, as opposed to the report, which is written at the
// end. Two files per session, both in the gitignored log folder beside the
// per-step logs:
//
//   logs/pipeline/<session>/run.log      one chronological, timestamped line
//                                        per event: step start, step end
//                                        (status, exit, duration), heartbeat
//                                        while a long step runs, and every
//                                        orchestrator message. `tail -f` it.
//   logs/pipeline/<session>/status.json  rewritten on every event: the step
//                                        running now, how long it has run,
//                                        counts so far, the last finished
//                                        step. Poll it.
//
// logs/pipeline/LATEST names the newest session, so a watcher does not have
// to guess which folder is current.
//
// Every write is best-effort: monitoring must never be the thing that fails
// a run, so an I/O error here is swallowed after one stderr warning.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REPO } from "../state";

const REAL_LOGS = path.join(REPO, "logs/pipeline");

export const HEARTBEAT_MS = 60_000;
/** A heartbeat line goes to run.log only every Nth beat (status.json gets
 *  every one), so a two-hour step adds 24 lines, not 120. */
const HEARTBEAT_LOG_EVERY = 5;

export interface MonitorStep {
  seq: number;
  id: string;
  command: string;
  log: string;
  startedAt: string;
  /** Median of this step's earlier ok durations, when known. */
  medianMs?: number;
}

interface Status {
  session: string;
  pid: number;
  phase: string;
  updatedAt: string;
  current: (MonitorStep & { elapsedS: number }) | null;
  counts: Record<string, number>;
  last: {
    seq: number;
    id: string;
    status: string;
    exitCode: number | null;
    durationS: number;
    log: string;
  } | null;
}

const quiet = (): boolean => !!process.env.VITEST;
let warned = false;
const safe = (fn: () => void): void => {
  try {
    fn();
  } catch (e) {
    if (warned) return;
    warned = true;
    process.stderr.write(
      `pipeline monitor: ${e instanceof Error ? e.message : String(e)} (further monitor errors suppressed)\n`,
    );
  }
};

const fmtDur = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
};

/** The process's ONE monitor: the first session to create one owns
 *  run.log, status.json and LATEST. A nested stage that mints its own session
 *  (the publish nightly starts) logs into the same stream instead of opening a
 *  second folder that would take over LATEST and stay at "starting". */
let primary: Monitor | null = null;

export class Monitor {
  private readonly status: Status;
  private timer: NodeJS.Timeout | null = null;
  private beats = 0;

  constructor(
    readonly session: string,
    readonly dir: string,
  ) {
    this.status = {
      session,
      pid: process.pid,
      phase: "starting",
      updatedAt: new Date().toISOString(),
      current: null,
      counts: {},
      last: null,
    };
    safe(() => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(path.dirname(dir), "LATEST"), `${session}\n`);
    });
  }

  /** Append one timestamped line to run.log and echo it to the console. */
  line(text: string, echo = true): void {
    const at = new Date().toISOString();
    safe(() =>
      fs.appendFileSync(path.join(this.dir, "run.log"), `${at} ${text}\n`),
    );
    // The console may be gone (SIGHUP closed the terminal): never let the
    // echo be what kills a run before it writes its report.
    if (echo && !quiet())
      safe(() => console.log(`${at.slice(11, 19)} ${text}`));
  }

  setPhase(phase: string): void {
    this.status.phase = phase;
    this.line(`── phase: ${phase}`);
    this.flush();
  }

  stepStart(s: MonitorStep): void {
    this.status.current = { ...s, elapsedS: 0 };
    this.line(
      `▶ ${String(s.seq).padStart(3, "0")} ${s.id} · ${s.command} · log ${s.log}` +
        (s.medianMs ? ` · usually ${fmtDur(s.medianMs)}` : ""),
    );
    this.flush();
    this.beats = 0;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.beat(), HEARTBEAT_MS);
    this.timer.unref();
  }

  stepEnd(o: {
    seq: number;
    id: string;
    status: string;
    exitCode: number | null;
    durationMs: number;
    log: string;
    firstError?: string;
  }): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.current = null;
    this.status.counts[o.status] = (this.status.counts[o.status] ?? 0) + 1;
    this.status.last = {
      seq: o.seq,
      id: o.id,
      status: o.status,
      exitCode: o.exitCode,
      durationS: Math.round(o.durationMs / 1000),
      log: o.log,
    };
    const mark = o.status === "ok" ? "✓" : o.status === "skipped" ? "·" : "✗";
    this.line(
      `${mark} ${String(o.seq).padStart(3, "0")} ${o.id} · ${o.status}` +
        (o.status === "skipped"
          ? ""
          : ` · exit ${o.exitCode ?? "—"} · ${fmtDur(o.durationMs)}`) +
        (o.status !== "ok" && o.firstError
          ? ` · ${o.firstError.slice(0, 200)}`
          : ""),
    );
    this.flush();
  }

  private beat(): void {
    const c = this.status.current;
    if (!c) return;
    const ms = Date.now() - Date.parse(c.startedAt);
    c.elapsedS = Math.round(ms / 1000);
    this.beats++;
    if (this.beats % HEARTBEAT_LOG_EVERY === 0) {
      const slow =
        c.medianMs && ms > 2 * c.medianMs
          ? ` — over 2× its usual ${fmtDur(c.medianMs)}`
          : "";
      this.line(
        `… ${String(c.seq).padStart(3, "0")} ${c.id} still running (${fmtDur(ms)})${slow}`,
      );
    }
    this.flush();
  }

  private flush(): void {
    this.status.updatedAt = new Date().toISOString();
    const file = path.join(this.dir, "status.json");
    safe(() => {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(this.status, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    });
  }

  close(summary: string): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status.phase = "done";
    this.line(`■ ${summary}`);
    this.flush();
  }
}

/** The process's monitor (steps and orchestrator share it, so run.log is a
 *  single ordered stream). The first call creates it; later calls — whatever
 *  session they name — return it. */
export const monitorFor = (session: string, dir: string): Monitor => {
  // Under a test runner the real logs/pipeline is off limits: a test that
  // records a skipped step would otherwise create a fake session folder
  // there and overwrite LATEST — during a live run, the one file a watcher
  // follows. (Found when the nightly's dead-run check named a session "s".)
  if (process.env.VITEST && path.resolve(dir).startsWith(REAL_LOGS))
    dir = path.join(os.tmpdir(), "pipeline-monitor-test", path.basename(dir));
  primary ??= new Monitor(session, dir);
  return primary;
};

/** The process monitor if one was created — for a CLI to close it on exit
 *  without minting one (a run that never started a step has none). */
export const currentMonitor = (): Monitor | null => primary;

/** Test hook: forget the process monitor. */
export const resetMonitorForTests = (): void => {
  primary = null;
};

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

export interface DeadRun {
  session: string;
  phase: string;
  /** The step running when it went silent, or null between steps. */
  step: string | null;
  updatedAt: string;
}

/** Runs whose process is gone but whose status.json never reached "done" —
 *  killed (SIGKILL, a closed session, a reboot) before it could write its
 *  report. Without this the next reader sees an older report and no trace of
 *  the run that died; with it, the next run names it. `hasReport` lets the
 *  caller skip one that did finish its report (killed after finalize). */
export const deadRuns = (
  logsRoot: string,
  current: string,
  hasReport: (session: string) => boolean,
  maxAgeDays = 14,
): DeadRun[] => {
  const out: DeadRun[] = [];
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(logsRoot);
  } catch {
    return out;
  }
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  for (const d of dirs.sort()) {
    if (d === current) continue;
    try {
      const st = JSON.parse(
        fs.readFileSync(path.join(logsRoot, d, "status.json"), "utf8"),
      ) as Status;
      if (st.phase === "done" || Date.parse(st.updatedAt) < cutoff) continue;
      if (pidAlive(st.pid) || hasReport(d)) continue;
      out.push({
        session: d,
        phase: st.phase,
        step: st.current ? `${st.current.seq} ${st.current.id}` : null,
        updatedAt: st.updatedAt,
      });
    } catch {
      // No status.json (an old run) — nothing to say.
    }
  }
  return out;
};
