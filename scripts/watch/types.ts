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

/** Something a HUMAN must fetch or paste before any ingest can run.
 *
 *  Distinct from `changed` on purpose. "Changed" means an upstream moved and a
 *  downstream skill can now run; this means the pipeline is BLOCKED until
 *  someone does something a script cannot. At least eight sources in this repo
 *  are in that position — TI CPI and Eurobarometer (manual paste), the
 *  `manual-pdf` ministry execution reports, `minfin_program_otchet`,
 *  `capital_programs` and its UNWATCHABLE Vidin entry, LISI, НОИ B1 — and each
 *  currently records the fact in prose somewhere else, where the daily report
 *  cannot surface it.
 *
 *  The report renders these ABOVE „Changed", because an ingest whose input is
 *  missing cannot be run at all. */
export interface ManualRequest {
  /** One line: what the operator must do. */
  instruction: string;
  /** Where to get it. */
  url: string;
  /** Exact filenames to save, when they are derivable. */
  files?: string[];
  /** Where they go, repo-relative. */
  dropDir?: string;
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
  /** Non-null when a human must fetch something before any ingest can run.
   *
   *  Evaluated on EVERY run — including runs where this source is off-cadence
   *  or its fetch failed, which is why `curr` is nullable: nothing was fetched
   *  on those paths. Three ways this could silently stop reporting, all closed
   *  deliberately:
   *
   *    - keyed on `changed`: a still-missing file does not move a fingerprint,
   *      so the source reports `unchanged` while the request stands;
   *    - keyed on the check window: none of the sources this exists for is
   *      daily (four monthly, three weekly), so a monthly source's outstanding
   *      download would surface on 1 day in 29;
   *    - dropped on `error`: an unreachable upstream does not make the missing
   *      file go away.
   *
   *  So it must be answerable WITHOUT a fresh fingerprint. Derive from `prev`
   *  or from what is on disk; treat `curr` as extra information when present. */
  manualRequest?(
    prev: WatchState | null,
    curr: Fingerprint | null,
  ): ManualRequest | null;
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
  /** Populated by the runner when `manualRequest()` returned non-null. */
  manual?: ManualRequest;
}
