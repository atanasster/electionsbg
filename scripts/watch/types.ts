// Shared types for the Tier 1 watcher.
// See docs/plans/data-watch-ingest-pipeline.md.

export type Cadence = "hourly" | "daily" | "weekly" | "monthly";

// How often the UPSTREAM can publish something new. Distinct from `cadence`,
// which is how often WE probe it. Declaring both lets `cadence.test.ts` assert
// the sampling invariant (see PUBLISH_PERIOD_MS in ./cadence).
//
// "irregular" means genuinely event-driven with no period to sample against
// (a register that changes when someone files something) — exempt from the
// invariant, so use it only when there is no meaningful period, not as a way
// to silence the check.
export type PublishFrequency =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual"
  | "irregular";

export interface Fingerprint {
  // Stable scalar used for equality. Hash, count, or max-timestamp string.
  value: string;
  // Human-readable detail for the report. e.g. "240 MPs · max date 2026-05-10".
  detail: string;
  // Optional structured payload persisted to state so describe() can format
  // a useful "what changed" line on the next run.
  meta?: Record<string, unknown>;
}

export interface WatchState {
  fingerprint: string;
  detail: string;
  meta?: Record<string, unknown>;
  lastChecked: string; // ISO UTC
  lastChanged: string; // ISO UTC; equals lastChecked on first run
}

export interface WatchSource {
  // Must match the state filename: state/watch/<id>.json.
  id: string;
  label: string;
  url: string;
  // How often WE probe. Must be fast enough for `publishes` — see ./cadence.
  cadence: Cadence;
  // How often the upstream publishes. Optional only because the 100+ sources
  // predate this field; declare it on every source you touch. Once declared,
  // `cadence.test.ts` enforces that `cadence` samples it at least twice per
  // publication period.
  publishes?: PublishFrequency;
  fingerprint(): Promise<Fingerprint>;
  // Optional override for the report's "what changed" line. Default just shows
  // current detail. Receives previous state (null on first run) and current fp.
  describe?(prev: WatchState | null, curr: Fingerprint): string;
}

export type ReportStatus =
  | "unchanged"
  | "changed"
  | "first-run"
  | "skipped"
  | "error";

export interface ReportEntry {
  source: WatchSource;
  status: ReportStatus;
  line: string;
  error?: string;
}
