// Its own module so `MotionSpark.tsx` exports only a component (fast refresh).

/** True when `firstSeenIso` is within the last `windowMs` of the reader's clock. Read time,
 *  never stored — the `daysUntil` rule: frozen into an artifact it would be wrong tomorrow. */
export const isFreshlySeen = (
  firstSeenIso: string | undefined,
  now = Date.now(),
  windowMs = 24 * 3_600_000,
): boolean => {
  if (!firstSeenIso) return false;
  const t = Date.parse(firstSeenIso);
  if (!Number.isFinite(t)) return false;
  return now - t >= 0 && now - t < windowMs;
};
