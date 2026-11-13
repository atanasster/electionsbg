// The watcher runner's decisions, as pure functions — what index.ts does
// with I/O around them. Kept apart so the state that gets written and the
// exit code a caller gates on are unit-tested, not just exercised by a
// daily run (plan §3.4).

import { carryScopeLog, type RunScope } from "./scope_log";
import { reportStreaks, standingProblem, type HealthLedger } from "./health";
import type { Fingerprint, ReportEntry, WatchState } from "./types";

/** The state written after a successful probe. `lastChanged` moves only on a
 *  change; the scope log is carried forward on every run (scope_log.ts). */
export const nextState = (
  prev: WatchState | null,
  curr: Fingerprint,
  scope: RunScope,
  runAt: string,
): WatchState => {
  const changed = !prev || prev.fingerprint !== curr.value;
  const meta = carryScopeLog(prev, curr, changed ? scope : null, runAt);
  return {
    fingerprint: curr.value,
    detail: curr.detail,
    ...(meta !== undefined ? { meta } : {}),
    lastChecked: runAt,
    lastChanged: changed ? runAt : prev!.lastChanged,
  };
};

/** Copy each entry's streak from the ledger onto it, for the reports. */
export const annotateStreaks = (
  entries: ReportEntry[],
  health: HealthLedger,
): void => {
  for (const e of entries) {
    const s = reportStreaks(e.status, health[e.source.id]);
    if (s.consecutiveErrors !== undefined)
      e.consecutiveErrors = s.consecutiveErrors;
    if (s.consecutiveBlocked !== undefined)
      e.consecutiveBlocked = s.consecutiveBlocked;
  }
};

/** 0 normally — the report is the success signal and lists every error.
 *  `--strict` returns 1 on any per-source error AND on any source whose
 *  blocked streak has become a standing problem: a source blocked every day
 *  is one nobody is watching, which a gate must not read as healthy. */
export const exitCode = (
  entries: readonly ReportEntry[],
  health: HealthLedger,
  strict: boolean,
): number => {
  if (!strict) return 0;
  return entries.some(
    (e) =>
      e.status === "error" ||
      (e.status === "blocked" && standingProblem(health[e.source.id]) !== null),
  )
    ? 1
    : 0;
};
