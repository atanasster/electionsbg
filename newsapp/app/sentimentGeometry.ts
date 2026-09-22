// Where a period's mean and its ±1 standard error sit on the position row.
//
// ⚠️ SEPARATE FROM THE COMPONENT so it can be tested as arithmetic, which is
// what it is. Positions are NORMALIZED by the scale's half-range, which is
// what lets a five-anchor and a nine-anchor run share one axis.

/** The display scale's half-range: `value` lives on ±(levels−1)/2 and the
 *  display scale has five anchors. */
export const EXTENT = 2;

export interface Whisker {
  /** Percent from the top of the row. */
  top: number;
  /** Percent from the bottom of the row. */
  bottom: number;
  /** The interval ran past the top of the scale and was cut. */
  clippedHigh: boolean;
  /** The interval ran past the bottom of the scale and was cut. */
  clippedLow: boolean;
}

/**
 * The ±1 SE interval as offsets, and whether either end was cut off.
 *
 * ⚠️ CLIPPING CHANGES THE CLAIM, SO IT IS REPORTED RATHER THAN ABSORBED.
 * Drawing a clamped whisker silently turns „±0.3 around +2.0" into a one-sided
 * interval with nothing to show it was cut — and any error at or beyond the
 * full range (two articles at opposite ends of the scale produce one) into a
 * full-height bar indistinguishable from a genuine full-scale spread.
 *
 * ⚠️ `se === 0` IS A REAL ANSWER, NOT A MISSING ONE. The producer emits `None`
 * only at n = 1; at n ≥ 2 with no variance it emits `0.0`, and a
 * "greater than zero" test would report a unanimous five-article period as a
 * single article.
 */
export const whiskerFor = (mean: number, se: number): Whisker => {
  const centre = clampUnit(mean / EXTENT);
  const spread = se / EXTENT;
  const high = centre + spread;
  const low = centre - spread;
  return {
    top: (1 - Math.min(1, high)) * 50,
    bottom: (1 + Math.max(-1, low)) * 50,
    clippedHigh: high > 1,
    clippedLow: low < -1,
  };
};

/** Percent from the top for one mean. */
export const markerTop = (mean: number): number =>
  (1 - clampUnit(mean / EXTENT)) * 50;

export const clampUnit = (n: number): number => Math.max(-1, Math.min(1, n));
