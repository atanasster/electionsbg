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

/**
 * A fund's share of its own segment, formatted identically in the corpus, the
 * prerendered HTML and the screen — the same reason judicialNum exists.
 *
 * NOT a share of its PILLAR, despite the field it was first named after.
 * `KfnFundRow.pillar` is the fund TYPE (УПФ / ППФ / ДПФ / ДПФПС); pillar 2 is
 * УПФ + ППФ together and pillar 3 is ДПФ + ДПФПС. Computing within the type is
 * the meaningful comparison — a ДПФПС against other ДПФПС — but calling it "дял
 * в стълба" published `ДПФПС „ДСК-Родина"` at 100.0% when its real pillar-3
 * share is 1.2%. The number was right and the label was wrong.
 */
export const kfnSharePct = (v: number, lang: string): string =>
  `${v.toLocaleString(lang, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
