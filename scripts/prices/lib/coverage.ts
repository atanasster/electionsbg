// How the КЗП feed's REPORTER COUNT is judged — the one definition, shared by
// the ingest guard (scripts/prices/load_day.ts) and the publisher
// (scripts/prices/build_index.ts).
//
// It lives here rather than in either of them because the two must agree. The
// ingest decides whether a thin day may be LOADED; the publisher decides
// whether a loaded day may be HEADLINED. Two copies of the rule would let a day
// be refused by one and quoted by the other.
//
// Why it exists at all: in 2026-08 the feed fell 203 → 98 chains over six days.
// The ingest's per-day floor compares against YESTERDAY, and the slide
// (203 → 140 → 132 → 115 → 107 → 101 → 98) crosses a 20% per-day threshold
// exactly ONCE while compounding to −52%. A monotone ratchet is invisible to a
// per-day comparison by construction — you need a reference the slide cannot
// drag along with it.

/** LOADED DAYS of history the baseline is taken over — array positions, not
 *  calendar days. The two agree only while the series has no gaps (measured:
 *  zero gaps in both the 225-day Postgres corpus and the 189-day cache), and
 *  the ingest tolerates a missing day by design, so a gap silently widens the
 *  real window. Acceptable because this is a reference for "is this day like
 *  its neighbours", not a period.
 *
 *  14 rather than 7: at 7 the median flips after 4 days at a new level, which
 *  is inside the length of the 2026-08 collapse itself — the guard would have
 *  started calling the collapse normal while it was still under way. */
export const COVERAGE_WINDOW_DAYS = 14;

/** A day whose reporter count is below this share of its trailing median is
 *  INCOMPLETE: not wrong, but not comparable with the days around it either.
 *
 *  0.8 matches the ingest's own per-day floor (SANITY_DROP = 0.2). The
 *  difference is the REFERENCE, not the tolerance.
 *
 *  Note what a trailing reference does and does not buy. It answers "is this
 *  day comparable with the days around it", so a sustained collapse stops being
 *  flagged once it occupies more than half the window — measured by continuing
 *  the real 2026-08 series at 98 chains, five days after the last step and
 *  eleven after the break began; nine days on a clean step. The new size
 *  becomes the new baseline, which is correct for comparability and useless as
 *  a record of the break. Nothing here is meant to catch the LEVEL shift; that
 *  is what the chain matching in build_index's matchedCell handles. */
export const COVERAGE_FLOOR = 0.8;

/** The trailing median reporter count for day `i`, over the preceding
 *  COVERAGE_WINDOW_DAYS (excluding `i` itself — a day cannot be its own
 *  reference). Null before there is enough history to judge against. */
export const trailingChainMedian = (
  chainsPerDay: number[],
  i: number,
): number | null => {
  const from = Math.max(0, i - COVERAGE_WINDOW_DAYS);
  // A zero-reporter day is an ingest gap, not a low reading — folding it in
  // would drag the reference toward zero and make the days after it look fine.
  const window = chainsPerDay.slice(from, i).filter((n) => n > 0);
  if (window.length < 3) return null;
  const sorted = [...window].sort((a, b) => a - b);
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
};

/** Is `chains` acceptable against a trailing median of `median`? A null median
 *  (not enough history) is not a pass or a fail — it means UNJUDGED, and both
 *  callers treat that as "do not block". */
export const clearsCoverageFloor = (
  chains: number,
  median: number | null,
): boolean => median == null || chains >= median * COVERAGE_FLOOR;
