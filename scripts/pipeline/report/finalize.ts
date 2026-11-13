// Turn a finished (or aborted) run into its artifacts: medians from history,
// one repair packet per failed step, the verdict, run.json and report.md.
// Shared by the ingest and publish runners.

import fs from "node:fs";
import path from "node:path";
import { readSteps } from "../../perf/perf_log";
import { REPO } from "../state";
import {
  codeContext,
  excerptLog,
  renderPacket,
  stepHistory,
  type PacketInput,
} from "./packet";
import {
  pruneRuns,
  runDir,
  verdictOf,
  writeRecord,
  type RunRecord,
  type StepRecord,
} from "./record";
import { renderReport } from "./render";

const median = (xs: number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median of a step's last 20 successful durations in OTHER sessions. */
export const medianIndex = (
  perfRun: string,
  session: string,
  perfDir?: string,
): ((stepId: string) => number | undefined) => {
  const by = new Map<string, number[]>();
  for (const s of readSteps(perfRun, perfDir).steps)
    if (s.status === "ok" && s.session !== session)
      by.set(s.step, [...(by.get(s.step) ?? []), s.durationMs]);
  return (id) => median((by.get(id) ?? []).slice(-20));
};

export interface PacketExtras {
  watcher?: PacketInput["watcher"];
  guidance?: string[];
  never?: string[];
  stateLeft: string[];
  doneMeans?: string[];
  reproduce?: (s: StepRecord) => string;
}

export interface FinalizeOptions {
  perfRun: string;
  scripts: Record<string, string>;
  /** Unit id → what a packet for a failure in it should add. */
  extras: (unitId: string, step: StepRecord) => PacketExtras;
  perfDir?: string;
  dir?: string;
  keepRuns?: number;
}

const defaultReproduce = (s: StepRecord): string => s.command;

/** Write packets, compute the verdict and write run.json + report.md. Returns
 *  the report path. Safe to call more than once (each call rewrites, the
 *  failures/ folder included). Prunes only UNTRACKED old run folders — see
 *  pruneRuns(). */
export const finalizeRun = (rec: RunRecord, opt: FinalizeOptions): string => {
  const dir = opt.dir ?? runDir(rec.session);
  const failDir = path.join(dir, "failures");
  // Rewritten from scratch on every call: a step that failed on an earlier
  // finalize and has since been resolved must not leave its packet behind.
  fs.rmSync(failDir, { recursive: true, force: true });
  const med = medianIndex(opt.perfRun, rec.session, opt.perfDir);

  const write = (
    u: RunRecord["units"][number],
    s: StepRecord,
    suffix: string,
    extra: { guidance: string[]; doneMeans?: string[] },
  ): string => {
    const ex = opt.extras(u.id, s);
    const packet: PacketInput = {
      session: rec.session,
      unit: u.id,
      step: s,
      reproduce: (ex.reproduce ?? defaultReproduce)(s),
      excerpt: s.log
        ? excerptLog(path.resolve(REPO, s.log), s.firstError)
        : null,
      code: codeContext(s.command, opt.scripts),
      history: stepHistory(opt.perfRun, s.id, rec.session, 5, opt.perfDir),
      watcher: ex.watcher ?? [],
      guidance: [...extra.guidance, ...(ex.guidance ?? [])],
      never: ex.never ?? [],
      stateLeft: ex.stateLeft,
      doneMeans: extra.doneMeans ??
        ex.doneMeans ?? [`\`${s.command}\` exits 0 when re-run.`],
      gates: u.gates,
    };
    fs.mkdirSync(failDir, { recursive: true });
    const file = path.join(
      failDir,
      `${String(s.seq).padStart(3, "0")}-${s.id.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80)}${suffix}.md`,
    );
    fs.writeFileSync(file, renderPacket(packet));
    return path.relative(REPO, file);
  };

  for (const u of rec.units) {
    for (const s of u.steps) {
      if (s.status !== "skipped") s.medianMs = med(s.id);
      if (s.status !== "error" && s.status !== "timeout") continue;
      s.packet = write(u, s, "", {
        guidance: s.failure
          ? [`Classifier hint (${s.failure.class}): ${s.failure.hint}`]
          : [],
      });
    }
    // Every step succeeded but a gate refused the result: the packet hangs
    // off the last step that ran, since its output is what the gate read.
    const badGates = u.gates.filter((g) => !g.ok);
    const ran = u.steps.filter((s) => s.status !== "skipped");
    if (
      badGates.length &&
      ran.length &&
      !u.steps.some((s) => s.status === "error" || s.status === "timeout")
    )
      u.gatePacket = write(u, ran[ran.length - 1], "-gate", {
        guidance: [
          `Every step exited 0, but the unit's gate(s) refused the result: ${badGates
            .map(
              (g) => `${g.id} expected ${g.expected}, observed ${g.observed}`,
            )
            .join(
              "; ",
            )}. The marker was NOT stamped, so the handler re-queues next run.`,
          "Decide whether the data really changed that much (then adjust the gate in the handler's registry entry) or the ingest is wrong (then fix it and re-run).",
        ],
        doneMeans: badGates.map(
          (g) => `gate ${g.id} passes on re-run (expected ${g.expected}).`,
        ),
      });
  }

  rec.verdict = verdictOf(rec);
  writeRecord(rec, dir);
  const report = path.join(dir, "report.md");
  fs.writeFileSync(report, renderReport(rec));
  if (!opt.dir) pruneRuns(opt.keepRuns);
  return report;
};
