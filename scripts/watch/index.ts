// Tier 1 watcher runner.
//
//   npm run watch        → diff fingerprints, write state, print report to
//                          stdout AND data-reports/<YYYY-MM-DD>.md.
//
// Designed to be invoked by a Claude Desktop local routine (one run per day).
// State changes commit themselves into state/watch/ via the routine's
// post-run git step; this script just writes files.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SOURCES } from "./sources/index";
import { readState, writeState } from "./state";
import { renderReport } from "./report";
import type { ReportEntry, WatchState } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORTS_DIR = path.resolve(__dirname, "../../data-reports");

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

  const report = renderReport(entries, runAt);
  process.stdout.write(report);

  // Persist a per-day copy under data-reports/. One file per UTC day; if the
  // routine runs more than once in a day the file is overwritten with the
  // freshest snapshot (state/watch/ still tracks the diff). `latest.md` is a
  // convenience pointer for "show me the most recent".
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const dayFile = path.join(REPORTS_DIR, `${runAt.slice(0, 10)}.md`);
  fs.writeFileSync(dayFile, report);
  const latestFile = path.join(REPORTS_DIR, "latest.md");
  fs.writeFileSync(latestFile, report);

  // Exit 0 even when individual sources errored — the report is the success
  // signal and lists every error in its own section. Whole-process crashes
  // (caught below) still exit 2 so true failures fail loudly.
};

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
