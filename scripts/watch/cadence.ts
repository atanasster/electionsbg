// Probe scheduling for the watcher, and the sampling invariant that governs it.
//
// Extracted from index.ts so it can be unit-tested: index.ts calls main() at
// module scope, so importing it from a test would fire a real watch run.
//
// THE INVARIANT (why this file exists). `cadence` is how often we PROBE;
// `publishes` is how often the upstream RELEASES. Probing no faster than the
// upstream publishes means detection is late by up to a full probe period —
// silently, because every surface downstream still reports a green run.
//
// This is not hypothetical. `eurostat` bundles prc_hicp_minr (HICP — a MONTHLY
// release) under `cadence: "monthly"`. Eurostat published the July 2026 HICP on
// 2026-07-31; the watcher had last probed on 2026-07-16 and was not due again
// until 2026-08-14, so `/indicators` served Q2 (5.8%) as the latest figure for
// a fortnight after July (4.1%) was public, and update-macro was never invoked.
// Nothing errored. Caught 2026-08-03 by hand, not by the pipeline.
//
// So: sample at least TWICE per publication period. Probing a monthly release
// monthly satisfies "faster than the data changes" on paper and is still up to
// 29 days late in practice, which is exactly the failure above.

import type { Cadence, PublishFrequency, WatchState } from "./types";

// Minimum gap between successive successful fingerprints, per cadence. Sources
// not yet at their next due time are reported as "skipped" and their state is
// left untouched — so a "weekly" source actually gets probed once a week even
// when the watcher itself runs daily. ~5% grace prevents clock drift / runtime
// variation from pushing the next check past one full period (e.g. a daily run
// taking 5 min wouldn't compound to "23h 59m" skipping the next day).
export const CADENCE_WINDOW_MS: Record<Cadence, number> = {
  hourly: 55 * 60 * 1000,
  daily: 23 * 60 * 60 * 1000,
  weekly: 6 * 24 * 60 * 60 * 1000,
  monthly: 29 * 24 * 60 * 60 * 1000,
};

const DAY = 24 * 60 * 60 * 1000;

// Shortest realistic gap between two upstream releases. Deliberately the FLOOR
// of each band, not the mean: a "monthly" publisher that happens to drop on the
// 28th and again on the 1st should not defeat the invariant.
export const PUBLISH_PERIOD_MS: Record<
  Exclude<PublishFrequency, "irregular">,
  number
> = {
  daily: DAY,
  weekly: 7 * DAY,
  monthly: 28 * DAY,
  quarterly: 90 * DAY,
  semiannual: 182 * DAY, // Eurostat S1/S2 tables, e.g. nrg_pc_204 energy prices
  annual: 365 * DAY,
};

export const dueForCheck = (
  prev: WatchState | null,
  cadence: Cadence,
  now: number,
): boolean => {
  if (!prev) return true; // first run always fires
  const window = CADENCE_WINDOW_MS[cadence];
  return now - Date.parse(prev.lastChecked) >= window;
};

/**
 * The sampling invariant: a probe period must fit at least twice into the
 * upstream's publication period. Returns null when satisfied (or when the
 * upstream is genuinely irregular), else a message naming the fix.
 */
export const cadenceViolation = (
  cadence: Cadence,
  publishes: PublishFrequency,
): string | null => {
  if (publishes === "irregular") return null;
  const probe = CADENCE_WINDOW_MS[cadence];
  const period = PUBLISH_PERIOD_MS[publishes];
  if (probe * 2 <= period) return null;
  // Suggest the SLOWEST cadence that still satisfies the invariant — probing
  // hourly would also "work" and would hammer the upstream for nothing.
  const fix = (Object.entries(CADENCE_WINDOW_MS) as [Cadence, number][])
    .sort((a, b) => b[1] - a[1])
    .find(([, ms]) => ms * 2 <= period);
  return (
    `cadence "${cadence}" (probe every ${Math.round(probe / DAY)}d) is too slow ` +
    `for an upstream that publishes ${publishes} (every ${period / DAY}d): a ` +
    `release can go unnoticed for a full probe period. ` +
    (fix
      ? `Use "${fix[0]}" or faster.`
      : `No supported cadence samples this fast.`)
  );
};
