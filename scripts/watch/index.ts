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

  // Exit 0 even when individual sources errored — the report is the success
  // signal and lists every error in its own section. If we exit non-zero,
  // the GH Actions workflow short-circuits before committing state and
  // posting the issue, hiding the report from the team. Whole-process
  // crashes (caught below) still exit 2 so true failures fail loudly.
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
