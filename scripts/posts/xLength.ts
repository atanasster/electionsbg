/**
 * X's character budget for a Наясно post.
 *
 * Kept in its own module for the same reason as `postedTo.ts`: `post_tool.ts`
 * calls `main()` at import time, so nothing there can be imported from a test.
 *
 * WHY A HARD LIMIT AND NOT A WARNING: X truncates silently at the cap, and what
 * it cuts is the END of the post — where the basis and the caveat live. A body
 * that loses its last line stops being „40,4%, при 40,9% за страната" and
 * becomes „40,4%", which is a different and worse claim.
 */

export const X_LIMIT = 280;

/** X counts any URL as this, however long it is — t.co rewrites them all. */
export const X_URL_WEIGHT = 23;

const URL_RE = /https?:\/\/\S+/g;

/**
 * Weighted length as X counts it.
 *
 * Two things `String.prototype.length` gets wrong here:
 *  - it counts UTF-16 units, so anything outside the BMP counts double when X
 *    would also count it double — accidentally right for emoji, but the brand
 *    bans those, so the agreement is luck rather than a reason to rely on it;
 *  - it counts a 60-character URL as 60 when X counts 23.
 *
 * Cyrillic sits in X's weight-1 range, exactly like Latin, so a Bulgarian post
 * gets the full 280 — a per-byte or per-UTF-8 count would wrongly halve it.
 */
export const xWeightedLength = (text: string): number => {
  const urls = text.match(URL_RE)?.length ?? 0;
  return [...text.replace(URL_RE, "")].length + urls * X_URL_WEIGHT;
};
