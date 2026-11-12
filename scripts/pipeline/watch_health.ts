// The watcher half of a nightly run, as report material.
//
// `pnpm run watch` exits 0 even when individual sources errored (its report
// is the success signal), so without this the ingest report never mentions a
// source that has been failing for a week: an erroring source keeps its old
// fingerprint, never flips, and is invisible to the planner. This reads the
// watcher's JSON report (data-reports/latest.json) and turns it into one
// "watcher" unit plus findings — errored sources, sources not probed because
// of the exit country, and standing streaks — at the top of the run report.

import type { StepOutcome } from "./exec/executor";
import { toStepRecord, type UnitRecord } from "./report/record";
import type { JsonReport } from "../watch/report";
import { STANDING_FAILURE_RUNS } from "../watch/health";

export interface WatcherSummary {
  units: UnitRecord[];
  findings: string[];
  /** Sources failing or blocked >= STANDING_FAILURE_RUNS runs in a row. */
  standing: string[];
  counts: Record<string, number>;
}

export const watcherPreamble = (
  step: StepOutcome,
  report: JsonReport | null,
  startedMs: number,
): WatcherSummary => {
  const findings: string[] = [];
  const standing: string[] = [];
  const counts: Record<string, number> = {};
  const fresh =
    report !== null && Date.parse(report.runAt) >= startedMs - 60_000;

  if (step.status === "ok" && !fresh)
    findings.push(
      `watcher: exited ok but data-reports/latest.json is ${report ? `from ${report.runAt}` : "missing"} — this run planned on whatever state/watch held`,
    );

  if (report && fresh) {
    for (const s of report.sources) {
      counts[s.status] = (counts[s.status] ?? 0) + 1;
      if (s.status === "error")
        findings.push(
          `watcher: ${s.id} errored${s.consecutiveErrors ? ` (${s.consecutiveErrors} run(s) in a row)` : ""}: ${s.error ?? s.line}`,
        );
      if ((s.consecutiveErrors ?? 0) >= STANDING_FAILURE_RUNS)
        standing.push(`${s.id} failing ${s.consecutiveErrors} runs in a row`);
      if ((s.consecutiveBlocked ?? 0) >= STANDING_FAILURE_RUNS)
        standing.push(
          `${s.id} not probed ${s.consecutiveBlocked} runs in a row (wrong exit country — switch the VPN for one run)`,
        );
    }
    const blocked = report.sources.filter((s) => s.status === "blocked");
    if (blocked.length)
      findings.push(
        `watcher: ${blocked.length} source(s) not probed from exit ${report.egress ?? "unknown"}: ${blocked.map((s) => s.id).join(", ")}`,
      );
    if (report.egressError)
      findings.push(
        `watcher: exit country unknown (${report.egressError}) — every source was probed`,
      );
    for (const s of standing) findings.push(`watcher STANDING: ${s}`);
  }

  const unit: UnitRecord = {
    id: "watcher",
    status:
      step.status !== "ok" ? "failed" : standing.length ? "partial" : "ok",
    steps: [toStepRecord(step)],
    gates: [],
    summary: Object.keys(counts).length
      ? Object.entries(counts)
          .sort()
          .map(([k, v]) => `${v} ${k}`)
          .join(", ")
      : undefined,
    ...(step.status !== "ok"
      ? { why: `the watcher ${step.status}: ${step.firstError ?? "no output"}` }
      : standing.length
        ? { why: `standing problem(s): ${standing.join("; ")}` }
        : {}),
  };
  return { units: [unit], findings, standing, counts };
};
