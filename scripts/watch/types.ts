// Shared types for the Tier 1 watcher.
// See docs/plans/data-watch-ingest-pipeline.md.

export type Cadence = "hourly" | "daily" | "weekly" | "monthly";

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
  cadence: Cadence;
  fingerprint(): Promise<Fingerprint>;
  // Optional override for the report's "what changed" line. Default just shows
  // current detail. Receives previous state (null on first run) and current fp.
  describe?(prev: WatchState | null, curr: Fingerprint): string;
}

export type ReportStatus = "unchanged" | "changed" | "first-run" | "error";

export interface ReportEntry {
  source: WatchSource;
  status: ReportStatus;
  line: string;
  error?: string;
}
