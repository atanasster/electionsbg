// Tier 1 watcher runner.
//
//   pnpm run watch        → diff fingerprints, write state, print report to
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
import { renderJsonReport, renderReport } from "./report";
import {
  egressMismatch,
  reachable,
  readHealth,
  updateHealth,
  writeHealth,
} from "./health";
import { lookupCountry } from "../pipeline/doctor";
import { annotateStreaks, exitCode, nextState } from "./run_core";
import { SCOPE_UNKNOWN, type RunScope } from "./scope_log";
import { CADENCE_WINDOW_MS, dueForCheck } from "./cadence";
import { rememberPollWatch } from "../polls/lib/capture";
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

const main = async (): Promise<number> => {
  const runAt = new Date().toISOString();
  const entries: ReportEntry[] = [];
  // The exit IP's country, once per run — only asked when some source
  // declares an `egress`. null = unknown, and then every source is probed.
  const egress = SOURCES.some((s) => s.egress)
    ? await lookupCountry()
    : { country: null };
  const country = egress.country;

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

    // A source behind the wrong exit would just time out after 300 s and
    // read as an upstream error. Say why instead, and leave its state (and so
    // its cadence window) untouched, exactly as for an error.
    // A country mismatch is only a HINT: a residential line in the "wrong"
    // country often reaches the host fine. Ask the host before skipping.
    let mismatch = egressMismatch(src.egress, country);
    if (mismatch && src.egressProbe && (await reachable(src.egressProbe)))
      mismatch = null;
    if (mismatch) {
      entries.push({
        source: src,
        status: "blocked",
        line: mismatch,
        manual: askManual(src, prev, null),
      });
      continue;
    }

    const t0 = Date.now();
    try {
      const fingerprintP = src.fingerprint();
      const timeoutP = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`source timed out after 300s`)),
          300_000,
        ),
      );
      const curr = await Promise.race([fingerprintP, timeoutP]);
      rememberPollWatch(src.id, curr.meta, runAt);
      const changed = !prev || prev.fingerprint !== curr.value;
      const status = !prev ? "first-run" : changed ? "changed" : "unchanged";
      const line = changed
        ? (src.describe?.(prev, curr) ?? curr.detail)
        : `unchanged (${curr.detail})`;

      // What moved, as data, for the pipeline's scoped steps. Computed from
      // the same comparison as the describe-line; a scope() that throws must
      // not cost the source its state write.
      let scope: RunScope = null;
      if (changed && src.scope)
        try {
          scope = src.scope(prev, curr);
        } catch (e) {
          // Unknown, not empty: the log restarts here so no consumer is
          // handed a partial union (scope_log.ts, SCOPE_UNKNOWN).
          scope = SCOPE_UNKNOWN;
          console.warn(
            `[watch] ${src.id}: scope() threw — ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      writeState(src.id, nextState(prev, curr, scope, runAt));
      // AFTER the state write: the request describes what is outstanding NOW,
      // so it must see the fingerprint this run produced, not the previous one.
      entries.push({
        source: src,
        status,
        line,
        manual: askManual(src, prev, curr),
        durationMs: Date.now() - t0,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      entries.push({
        source: src,
        status: "error",
        line: msg,
        error: msg,
        durationMs: Date.now() - t0,
        // An unreachable upstream does not make the outstanding download go
        // away — if anything it is the run where the operator most needs to be
        // told. `curr` is null: the fetch is what failed.
        manual: askManual(src, prev, null),
      });
      // Don't update state on error — leave previous fingerprint intact so the
      // next successful run can still detect "changed since last good".
    }
  }

  // The health ledger: consecutive failures per source, which the per-source
  // state cannot hold (it is deliberately not written on error).
  const health = updateHealth(
    readHealth(),
    entries.map((e) => ({ id: e.source.id, status: e.status, error: e.error })),
    runAt,
  );
  writeHealth(health);
  annotateStreaks(entries, health);

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
  // The same run as data, for scripts (the pipeline reads this, not markdown).
  const json =
    JSON.stringify(
      renderJsonReport(entries, runAt, country, egress.error),
      null,
      2,
    ) + "\n";
  fs.writeFileSync(path.join(REPORTS_DIR, `${runAt.slice(0, 10)}.json`), json);
  fs.writeFileSync(path.join(REPORTS_DIR, "latest.json"), json);

  // Exit 0 even when individual sources errored — the report is the success
  // signal and lists every error in its own section. Whole-process crashes
  // (caught below) still exit 2 so true failures fail loudly. `--strict`
  // exits 1 on a per-source error or a standing blocked streak (run_core).
  return exitCode(entries, health, process.argv.includes("--strict"));
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
  (code) => exitWhenDrained(code),
  (e) => {
    console.error(e);
    exitWhenDrained(2);
  },
);
