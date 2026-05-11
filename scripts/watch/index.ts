// Tier 1 watcher runner.
//
//   npm run watch        → diff fingerprints, write state, print report to stdout.
//
// Invoked by .github/workflows/watch.yml on a daily cron. The workflow captures
// stdout, opens a GitHub issue with the report, and commits any state changes.

import { SOURCES } from "./sources/index";
import { readState, writeState } from "./state";
import { renderReport } from "./report";
import type { ReportEntry, WatchState } from "./types";

const main = async (): Promise<void> => {
  const runAt = new Date().toISOString();
  const entries: ReportEntry[] = [];

  for (const src of SOURCES) {
    const prev = readState(src.id);
    try {
      const curr = await src.fingerprint();
      const changed = !prev || prev.fingerprint !== curr.value;
      const status = !prev ? "first-run" : changed ? "changed" : "unchanged";
      const line = changed
        ? (src.describe?.(prev, curr) ?? curr.detail)
        : `unchanged (${curr.detail})`;

      const next: WatchState = {
        fingerprint: curr.value,
        detail: curr.detail,
        meta: curr.meta,
        lastChecked: runAt,
        lastChanged: changed ? runAt : prev!.lastChanged,
      };
      writeState(src.id, next);
      entries.push({ source: src, status, line });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      entries.push({
        source: src,
        status: "error",
        line: msg,
        error: msg,
      });
      // Don't update state on error — leave previous fingerprint intact so the
      // next successful run can still detect "changed since last good".
    }
  }

  process.stdout.write(renderReport(entries, runAt));

  // Silence is treated as failure per PRD success criteria. We always print a
  // report, but exit non-zero if any source errored so the workflow step
  // surfaces the failure (and the team gets the issue with errors listed).
  if (entries.some((e) => e.status === "error")) {
    process.exitCode = 1;
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
