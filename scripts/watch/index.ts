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
import { CADENCE_WINDOW_MS, dueForCheck } from "./cadence";
import type {
  Fingerprint,
  ManualRequest,
  ReportEntry,
  WatchSource,
  WatchState,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORTS_DIR = path.resolve(__dirname, "../../data-reports");

const main = async (): Promise<void> => {
  const runAt = new Date().toISOString();
  const entries: ReportEntry[] = [];

  const nowMs = Date.parse(runAt);

  // Asking is deliberately separated from checking. A request-builder that
  // throws must not turn a SUCCESSFUL fingerprint into an `error` entry whose
  // state has already been written — and it must never be the reason a source
  // stops reporting, because a persistently-buggy builder would then hide the
  // very download it exists to ask for.
  const askManual = (
    src: WatchSource,
    prev: WatchState | null,
    curr: Fingerprint | null,
  ): ManualRequest | undefined => {
    if (!src.manualRequest) return undefined;
    try {
      return src.manualRequest(prev, curr) ?? undefined;
    } catch (e) {
      console.warn(
        `[watch] ${src.id}: manualRequest() threw — ${e instanceof Error ? e.message : String(e)}`,
      );
      return undefined;
    }
  };

  for (const src of SOURCES) {
    const prev = readState(src.id);

    if (!dueForCheck(prev, src.cadence, nowMs)) {
      // Off-cadence: leave state alone so the next eligible run still detects
      // any change vs. the last good fingerprint. Reuse prev.detail so the
      // report still tells the user what was last seen.
      const nextDueMs =
        Date.parse(prev!.lastChecked) + CADENCE_WINDOW_MS[src.cadence];
      const nextDue = new Date(nextDueMs).toISOString().slice(0, 10);
      // Off-cadence still ASKS. A missing file blocks the ingest every day, not
      // only on the days the upstream is due — and none of the sources this
      // capability exists for is daily (four monthly, three weekly), so keying
      // the request to the check window would surface a monthly source's
      // outstanding download on 1 day in 29. That is the same silence the
      // design set out to prevent, reached through cadence instead of through
      // `changed`. `curr` is null here: nothing was fetched this run.
      entries.push({
        source: src,
        status: "skipped",
        line: `${prev!.detail} · next check ${nextDue}`,
        manual: askManual(src, prev, null),
      });
      continue;
    }

    try {
      const fingerprintP = src.fingerprint();
      const timeoutP = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`source timed out after 300s`)),
          300_000,
        ),
      );
      const curr = await Promise.race([fingerprintP, timeoutP]);
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
      // AFTER the state write: the request describes what is outstanding NOW,
      // so it must see the fingerprint this run produced, not the previous one.
      entries.push({
        source: src,
        status,
        line,
        manual: askManual(src, prev, curr),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      entries.push({
        source: src,
        status: "error",
        line: msg,
        error: msg,
        // An unreachable upstream does not make the outstanding download go
        // away — if anything it is the run where the operator most needs to be
        // told. `curr` is null: the fetch is what failed.
        manual: askManual(src, prev, null),
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

// The watcher must actually terminate: it runs unattended (one daily routine
// invocation), so a run that never exits leaves a stray node process behind
// every day. Observed on the 2026-07-24 run — it wrote the report and both
// data-reports/ files, then sat idle for 26+ minutes until killed: some source
// leaves a handle open that keeps the event loop alive past the last
// fingerprint. Which one is unidentified (a lone keep-alive undici `Agent`,
// the obvious suspect, does *not* reproduce it), so force the exit rather than
// chase the leak — a completed report is the whole output of this script.
// Exit only once stdout has drained: `process.exit()` truncates pending writes
// when stdout is a pipe, and the routine captures the report from stdout.
const exitWhenDrained = (code: number): void => {
  process.exitCode = code;
  // Backstop for a blocked or already-closed pipe reader, where the drain
  // callback would never fire. Unref'd so it can't itself keep an otherwise
  // idle loop alive.
  setTimeout(() => process.exit(code), 5_000).unref();
  // Queued behind the report write above, so its callback runs after the
  // report has flushed.
  process.stdout.write("", () => process.exit(code));
};

main().then(
  () => exitWhenDrained(0),
  (e) => {
    console.error(e);
    exitWhenDrained(2);
  },
);
