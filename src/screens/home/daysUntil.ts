// ⚠️ ITS OWN MODULE BECAUSE THE COUNTDOWN IS NOT STORED, AND THAT IS THE WHOLE POINT.
// `deadlineAt` is a fact in the artifact; „остават 3 дни" is a function of the reader's clock,
// so it is computed at render time — the `open_calls` (migration 142) rule one layer up, where
// a status frozen at crawl time shows an expired call as open all weekend after a Friday
// failure. It lived beside the card and was exported from it, which costs a fast-refresh
// warning for a function that is not a component.

/** Whole days from now until `iso`, or null when it is past. Read time, never stored. */
export const daysUntil = (iso: string, now = Date.now()): number | null => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const days = Math.ceil((t - now) / 86_400_000);
  return days >= 0 ? days : null;
};
