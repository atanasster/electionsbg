// Merge one parsed КФН quarter into the retained archive.
//
// WHY MERGE AND NOT OVERWRITE. The writer used to parse the newest ZIP and
// writeFileSync straight over data/budget/kfn/funds.json, so every ingest
// destroyed the previous quarter and the served file was a single snapshot.
// /pension-fund/:slug wants a trend, and a fund's trend is the whole point.
//
// THE ARCHIVE IS THE DURABLE STORE, NOT THE ZIP CACHE. `raw_data/budget/` is
// gitignored (.gitignore:182) and the ZIPs are untracked, so re-deriving the
// series from disk would make it a property of one machine — a fresh clone
// would restart from one quarter with nothing to say it had lost anything.
// data/budget/kfn/funds.json is tracked, so it holds the history and each
// ingest folds into it.
//
// Pure, so the shrink guard and the idempotency are testable without a ZIP.

import type { KfnFundsFile, KfnFundsArchive, KfnPeriod } from "./parse_kfn";
import { kfnFundSlug, isDegenerateFundSlug } from "@/lib/kfnFundSlug";

export interface MergeResult {
  archive: KfnFundsArchive;
  /** True when the incoming period was already present (re-parsing the same
   *  quarter is a no-op, so a re-run is safe). */
  replaced: boolean;
  periodsBefore: number;
}

/** True when two periods carry the same funds — used to keep a re-parse from
 *  restamping `generatedAt` for no reason. */
const sameFunds = (a: KfnPeriod, b: KfnPeriod): boolean =>
  JSON.stringify(a.funds) === JSON.stringify(b.funds);

export class KfnShrinkError extends Error {}
export class KfnPillarGapError extends Error {}
export class KfnSlugError extends Error {}

/** Every pillar a complete quarter carries. VPFOS is a single fund and has been
 *  present in every archive seen; the other three are ten funds each. */
const EXPECTED_PILLARS = ["UPF", "PPF", "VPF", "VPFOS"] as const;

/** Pillars present in a period. */
const pillarsOf = (p: KfnPeriod): Set<string> =>
  new Set(p.funds.map((f) => f.pillar));

/**
 * Fold `incoming` into `existing`, keyed on `period`.
 *
 * @param existing the archive read off disk, or null on first run.
 * @param allowShrink override the guard. Only for a deliberate re-seed.
 * @throws KfnPillarGapError when the incoming quarter is missing a pillar —
 *   the data loss that actually occurs, and which no period count can see.
 * @throws KfnShrinkError when the merge would emit fewer periods than it read.
 *   NOTE this compares against the file it was handed, so it cannot detect that
 *   THAT file was already truncated — it catches a merge that would collapse
 *   periods (duplicate keys), not an upstream truncation. The real data-loss
 *   guard is the pillar check above.
 */
export const mergeKfnArchive = (
  existing: KfnFundsArchive | null,
  incoming: KfnFundsFile,
  allowShrink = false,
): MergeResult => {
  const prior = existing?.periods ?? [];
  const periodsBefore = prior.length;

  const next: KfnPeriod = {
    period: incoming.period,
    periodLabel: incoming.periodLabel,
    funds: incoming.funds,
  };
  const replaced = prior.some((p) => p.period === next.period);
  const merged = [...prior.filter((p) => p.period !== next.period), next].sort(
    (a, b) => a.period.localeCompare(b.period),
  );

  // A MISSING PILLAR is the data loss the shrink guard cannot see, and the one
  // that actually happened: an English archive ships both VPF_* and DPF_*, the
  // matcher reached the wrong one, and the whole voluntary pillar vanished —
  // 21 funds instead of 31, €851M of assets — with no warning. Committed, it
  // reads as GROWTH against the next quarter rather than as a parse failure.
  // A period is only as trustworthy as its pillar coverage, so refuse it.
  const present = pillarsOf(next);
  const missing = EXPECTED_PILLARS.filter((p) => !present.has(p));
  if (!allowShrink && missing.length > 0)
    throw new KfnPillarGapError(
      `${incoming.periodLabel} is missing pillar(s) ${missing.join(", ")} ` +
        `(${next.funds.length} funds). That is a PARSE failure, not a source ` +
        `gap — a partial quarter reads as growth against its neighbours. ` +
        `Check the workbook filename patterns in parse_kfn.ts (WORKBOOKS).`,
    );

  // The /pension-fund/:slug identity must be derivable and unique, and it can
  // fail SILENTLY: companyOf() falls back to the raw (Cyrillic) fund name for a
  // company it cannot map, which the slugger strips to just the pillar. Two
  // such funds collide onto one URL and blend into one trend. Catch it here,
  // where the workbook is still on disk and the mapping can be added.
  const slugs = next.funds.map((f) => ({
    slug: kfnFundSlug(f.pillar, f.companyEn),
    pillar: f.pillar,
    name: f.fundName,
  }));
  const degenerate = slugs.filter((s) =>
    isDegenerateFundSlug(s.slug, s.pillar),
  );
  const dupes = slugs
    .map((s) => s.slug)
    .filter((s, i, a) => a.indexOf(s) !== i);
  if (!allowShrink && (degenerate.length > 0 || dupes.length > 0))
    throw new KfnSlugError(
      `${incoming.periodLabel}: ` +
        (degenerate.length
          ? `${degenerate.length} fund(s) slug to their pillar alone ` +
            `(${degenerate.map((d) => d.name).join(", ")}) — add them to ` +
            `COMPANIES in parse_kfn.ts. `
          : "") +
        (dupes.length
          ? `duplicate slug(s): ${[...new Set(dupes)].join(", ")}.`
          : ""),
    );

  if (!allowShrink && merged.length < periodsBefore)
    throw new KfnShrinkError(
      `merge would drop ${periodsBefore - merged.length} period(s) ` +
        `(${periodsBefore} → ${merged.length}). Pass --allow-shrink only if ` +
        `that is deliberate.`,
    );

  // Keep the previous stamp when nothing actually moved, so a re-run of the
  // same quarter leaves the file byte-identical and does not show up as a diff.
  const unchanged =
    replaced &&
    merged.length === periodsBefore &&
    prior.every((p, i) => sameFunds(p, merged[i]));

  return {
    archive: {
      generatedAt:
        unchanged && existing ? existing.generatedAt : incoming.generatedAt,
      source: incoming.source,
      latestPeriod: merged[merged.length - 1].period,
      periods: merged,
    },
    replaced,
    periodsBefore,
  };
};
