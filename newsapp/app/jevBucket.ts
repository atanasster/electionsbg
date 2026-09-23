// The bucket label of a published Jev score. Its own module so the component
// file exports only components (fast refresh), and so both the article page
// and any later surface read the one rule.

import type { JevScore } from "./data";
import { bucketLabel } from "./sentimentScale";

/**
 * The bucket label for a score: the build's own `bucket_index` when it sent
 * one, else computed here. ⚠️ The shipped index wins because `value` is
 * rounded for the wire — see `JevScore.bucket_index`.
 */
export const bucketOf = <T extends string>(
  score: JevScore & { value: number; levels: number },
  order: readonly T[],
): T => {
  const i = score.bucket_index;
  return typeof i === "number" &&
    Number.isInteger(i) &&
    i >= 0 &&
    i < order.length
    ? order[i]
    : bucketLabel(score.value, score.levels, order);
};
