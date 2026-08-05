// Which КФН quarter is "latest".
//
// There were three answers to one question: the prerender reader sorted by
// `period` and took the last, `useKfnFund` took the last element in ARRAY order,
// and `useKfnLatest` read `payload.latestPeriod`. They agree only because the
// committed archive happens to be written ascending — a re-ingest that appended
// an older quarter would have made the prerendered description name a different
// quarter from the page it stands in for, with nothing failing.
//
// `period` is an ISO date (`2026-03-31`), so a lexical compare IS a chronological
// one; the point is that everyone applies it.

/** Sort comparator for КФН periods — ascending, so `[last]` is the newest. */
export const byKfnPeriod = <T extends { period: string }>(a: T, b: T): number =>
  a.period.localeCompare(b.period);
