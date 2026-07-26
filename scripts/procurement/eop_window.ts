// Incremental-window sizing for the ЦАИС ЕОП flat-договори gap-fill (ingest_eop.ts).
//
// Two incremental cadences share the same crawl:
//   - plain `--apply` (absent-buyer gap-fill): a cheap ~30-day look-back is
//     enough, because a buyer entirely absent from our corpus can't double-count.
//   - `--self-heal` (covered-buyer cross-source-dedup): the window MUST exceed
//     the worst-case lag of АОП's OCDS export behind the live ЦАИС feed, or a
//     covered buyer's recent contract stays missing until OCDS finally catches
//     up. The observed lag runs ~7 weeks (a 51-day gap on 2026-07-26), so 75 days
//     leaves a comfortable margin. The eviction guard in ingest.ts removes the
//     `eop-` twin once its OCDS row lands, so a wide window can't double-count.
export const INCREMENTAL_WINDOW_DAYS = 30;
export const SELF_HEAL_WINDOW_DAYS = 75;

// A window wider than this needs an explicit --backfill, so an accidental
// full-history crawl is never triggered by the cadence flags alone. Self-heal's
// 75-day default sits below its 90-day cap; the plain path keeps the tighter ~5wk
// cap. Both are lifted by --backfill (the deliberate 2020→ one-off).
export const INCREMENTAL_MAX_DAYS = 40;
export const SELF_HEAL_MAX_DAYS = 90;

const DAY_MS = 86_400_000;

// The default `--from` (YYYY-MM-DD) for an incremental run when the caller passes
// none: `nowMs` minus the cadence's look-back. `selfHeal` widens it to cover the
// OCDS-export lag.
export const incrementalFromDate = (nowMs: number, selfHeal: boolean): string =>
  new Date(
    nowMs -
      (selfHeal ? SELF_HEAL_WINDOW_DAYS : INCREMENTAL_WINDOW_DAYS) * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);

// Max window (in days) allowed WITHOUT --backfill for the given cadence.
export const windowGuardCap = (selfHeal: boolean): number =>
  selfHeal ? SELF_HEAL_MAX_DAYS : INCREMENTAL_MAX_DAYS;

// Inclusive-both-ends list of YYYY-MM-DD days from `from` to `to`. The guard
// compares this length (delta + 1) against windowGuardCap, so it lives here next
// to the sizing constants it's checked against.
export const enumerateDays = (from: string, to: string): string[] => {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = start; t <= end; t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
};

// Resolve the interdependent cadence flags into the two effective modes, or throw
// the same guard the CLI enforced inline. `--self-heal` is the incremental
// cadence of cross-source-dedup, so it implies it; cross-source-dedup (however
// reached) implies keeping existing buyers; and `--only-buyers` needs one of
// those, since a whitelisted buyer is already in the corpus and would otherwise
// double-count. Pure so the flag matrix is unit-testable without the I/O in main().
export const resolveEopModes = (flags: {
  crossSourceDedup: boolean;
  selfHeal: boolean;
  includeExistingBuyers: boolean;
  onlyBuyersCount: number;
}): { crossSourceDedup: boolean; includeExistingBuyers: boolean } => {
  const crossSourceDedup = flags.crossSourceDedup || flags.selfHeal;
  const includeExistingBuyers = flags.includeExistingBuyers || crossSourceDedup;
  if (flags.onlyBuyersCount > 0 && !crossSourceDedup) {
    throw new Error(
      `--only-buyers requires --cross-source-dedup (or --self-heal) — the ` +
        `whitelisted buyers are already in the corpus, so their EOP rows would ` +
        `double-count the OCDS/legacy base without content dedup`,
    );
  }
  return { crossSourceDedup, includeExistingBuyers };
};
