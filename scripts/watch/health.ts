// The watcher's health ledger: consecutive failures per source, kept apart
// from state/watch/<id>.json on purpose — a source's state file is NOT
// written on error (so the next good run still diffs against the last good
// fingerprint), which means the state file alone can never say "this has
// been failing for nine days". Plan: docs/plans/watch-pipeline-scripts-v1.md §3.4.
//
// File: state/watch/_health.json. The leading `_` is a CONVENTION, not a
// filter: the pipeline's loadState skips `_`-prefixed files, but a shell glob
// like `state/watch/*.json` still matches it — such a reader must skip it.

import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "./state";
import type { WatchSource } from "./types";

export interface SourceHealth {
  consecutiveErrors: number;
  /** Consecutive runs this source could not be probed from the exit it got.
   *  Not an upstream failure — but a source blocked every day is a source
   *  nobody is watching, so it escalates the same way. */
  consecutiveBlocked?: number;
  /** When the current failure streak began. */
  firstFailedAt?: string;
  lastError?: string;
  lastOkAt?: string;
}

export type HealthLedger = Record<string, SourceHealth>;

export const HEALTH_FILE = path.join(STATE_DIR, "_health.json");

/** A streak this long is reported as a standing problem, not a blip. */
export const STANDING_FAILURE_RUNS = 3;

export const readHealth = (file: string = HEALTH_FILE): HealthLedger => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as HealthLedger;
  } catch {
    return {};
  }
};

/** Pure: the ledger after one run's outcomes. `skipped` (off-cadence) leaves
 *  everything untouched. `blocked` is no evidence about the upstream, so it
 *  leaves the ERROR streak alone and counts its own streak instead. */
export const updateHealth = (
  prev: HealthLedger,
  outcomes: readonly { id: string; status: string; error?: string }[],
  at: string,
): HealthLedger => {
  const next: HealthLedger = { ...prev };
  for (const o of outcomes) {
    const h = next[o.id] ?? { consecutiveErrors: 0 };
    if (o.status === "blocked")
      next[o.id] = {
        ...h,
        consecutiveBlocked: (h.consecutiveBlocked ?? 0) + 1,
      };
    else if (o.status === "error") {
      // Probed (and failed): the blocked streak, if any, is over.
      const { consecutiveBlocked: _ended, ...rest } = h;
      void _ended;
      next[o.id] = {
        ...rest,
        consecutiveErrors: h.consecutiveErrors + 1,
        firstFailedAt: h.consecutiveErrors === 0 ? at : (h.firstFailedAt ?? at),
        lastError: (o.error ?? "").slice(0, 300),
      };
    } else if (
      o.status === "changed" ||
      o.status === "unchanged" ||
      o.status === "first-run"
    )
      next[o.id] = { consecutiveErrors: 0, lastOkAt: at };
  }
  return Object.fromEntries(
    Object.entries(next).sort(([a], [b]) => a.localeCompare(b)),
  );
};

/** Why this source's streak is a standing problem (>= STANDING_FAILURE_RUNS
 *  in a row), or null. */
export const standingProblem = (h: SourceHealth | undefined): string | null => {
  if (!h) return null;
  if (h.consecutiveErrors >= STANDING_FAILURE_RUNS)
    return `failing ${h.consecutiveErrors} runs in a row`;
  if ((h.consecutiveBlocked ?? 0) >= STANDING_FAILURE_RUNS)
    return `blocked ${h.consecutiveBlocked} runs in a row — never probed`;
  return null;
};

export const writeHealth = (
  ledger: HealthLedger,
  file: string = HEALTH_FILE,
): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + "\n");
};

/** Why this source cannot be probed from `country`, or null. */
export const egressMismatch = (
  need: WatchSource["egress"],
  country: string | null,
): string | null => {
  if (!need || country === null) return null;
  if (need === "bg" && country !== "BG")
    return `needs a Bulgarian exit; this run exits via ${country}`;
  if (need === "non-bg" && country === "BG")
    return "needs a NON-Bulgarian exit (the upstream times out behind a BG VPN); this run exits via BG";
  return null;
};
