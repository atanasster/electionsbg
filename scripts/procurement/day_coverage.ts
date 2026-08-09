// Day-coverage audit for the day-bucket ingest caches.
//
// WHY THIS EXISTS (docs/plans/tender-dossier-ingest-v1.md §11). ingest_tenders
// rebuilds the whole corpus from "every day-bucket present in the cache", so a day
// that was never fetched is indistinguishable from a day the source published
// nothing on: the corpus just comes out smaller and every count still reconciles.
//
// That is not hypothetical. 69 consecutive days — 2023-10-24 → 2023-12-31 — were
// missing from raw_data/procurement/eop_tenders/ for ~2.5 years. Every run
// republished the holed corpus at exit 0. The gap was found only by walking the
// ЦАИС tenderId space and noticing published procedures the corpus did not have;
// ~4,100 procedures, 3.4% of the ЦАИС era.
//
// THE DISCRIMINATOR IS THE FILE, NOT ITS CONTENTS. fetchDay caches a genuinely
// unpublished day as `[]`, and deliberately does NOT cache a 403 (an egress block
// is not "no data"). So "no file" means "never successfully fetched" and nothing
// else — which is exactly the condition worth refusing to build on.
//
// Lives in its own module because ingest_tenders.ts runs its CLI at import time.

import fs from "fs";
import path from "path";

export interface DayGap {
  /** Basename of the cache dir, so a report can name which tree is holed. */
  dir: string;
  from: string;
  to: string;
  days: number;
}

const DAY_MS = 86_400_000;

const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);

/**
 * Contiguous runs of never-fetched days INSIDE a cache dir's own [first, last]
 * range.
 *
 * Bounded by the dir's own extremes on purpose: the caches are disjoint eras (РОП
 * 2010–2019, ЦАИС 2020→) and auditing their union would flag the one-day seam
 * between them (2020-01-01, a holiday with nothing published) as a hole for ever.
 * It also means a cache that simply has not caught up to today is not "holed" —
 * only interior days count.
 *
 * Returns [] for a dir that is absent or has fewer than two days, since neither
 * has an interior.
 */
export const missingDayRuns = (dir: string): DayGap[] => {
  if (!fs.existsSync(dir)) return [];
  const days = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json.gz"))
    .map((f) => f.slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  if (days.length < 2) return [];

  const have = new Set(days);
  const label = path.basename(dir);
  const runs: DayGap[] = [];
  const lo = Date.parse(`${days[0]}T00:00:00Z`);
  const hi = Date.parse(`${days[days.length - 1]}T00:00:00Z`);

  let openAt: number | null = null;
  for (let t = lo; t <= hi; t += DAY_MS) {
    const present = have.has(iso(t));
    if (present && openAt !== null) {
      runs.push({
        dir: label,
        from: iso(openAt),
        to: iso(t - DAY_MS),
        days: Math.round((t - openAt) / DAY_MS),
      });
      openAt = null;
    } else if (!present && openAt === null) {
      openAt = t;
    }
  }
  // A run cannot still be open at `hi`: hi is present by construction.
  return runs;
};

/** Every interior missing day across the given cache dirs, in the order supplied. */
export const auditDayCoverage = (dirs: readonly string[]): DayGap[] =>
  dirs.flatMap((d) => missingDayRuns(d));

export const totalMissingDays = (gaps: readonly DayGap[]): number =>
  gaps.reduce((s, g) => s + g.days, 0);
