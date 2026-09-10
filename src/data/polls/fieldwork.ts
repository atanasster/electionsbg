// The `fieldwork` string is a CONTRACT, and this module owns both ends of it.
//
// Two things in the polls corpus are derived from that one string, which is why
// it cannot be free text:
//
//   - the poll id — `<agencyId>-<fieldwork end ISO>` (`ml-2026-07-19`), so a
//     string the parser reads differently from the writer that produced it mints
//     a DIFFERENT id and the same poll lands twice;
//   - every accuracy figure — `analyze_accuracy.ts` scores each agency's LAST
//     poll before the vote and reports `daysBefore`, both keyed on the parsed
//     end date. A string the parser cannot read drops the poll out of scoring
//     silently: `parseFieldworkEnd` returns null and the row is skipped, so the
//     agency is measured on an older wave with nothing failing.
//
// Keep this module DOM/React-free — `scripts/polls/**` imports it from node,
// exactly as `aliases.ts` is imported by `analyze_accuracy.ts`.
//
// Consumers, so "who else has to agree with this" is answerable from here:
//   - `scripts/polls/analyze_accuracy.ts`  — reads (scoring)
//   - `scripts/polls/scrape_polls.ts`      — writes (`formatFieldwork` + `pollId`)
//   - `src/screens/polls/AgencyPollsList.tsx` — reads (sort key)
//   - `scripts/polls/polls_corpus.test.ts` — asserts the corpus against both ends
// `accept` (the ingest promotion step) will join them; it does not exist yet.

/** Month index by lowercase 3-letter English abbreviation. */
const MONTH_EN: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Canonical 3-letter month names, indexed 0-11. The writer's vocabulary. */
export const MONTH_EN_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * The EXACT forms, in match order — the parser's whole vocabulary.
 *
 * ONE array, two consumers: `parseFieldworkEnd` matches against it, and
 * `isFuzzyFieldwork` decides by elimination against the same entries. They were
 * two hand-copied sets for one commit, which is the drift this shape removes: a
 * fifth form added to the parser alone would have parsed exactly while being
 * reported as fuzzy, and `isFuzzyFieldwork` is what a gate uses to tell an
 * inherited row from a newly written one — so the gate would have rejected a
 * correctly written new poll.
 *
 * Group positions differ per form (that is why extraction stays per-branch);
 * the shared thing is the PATTERN, which is what drifts.
 */
const EXACT_FORMS = {
  /** "through Mon D YYYY" — publication date known, fieldwork range not. */
  through: /^through\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/i,
  /** Cross-month range: "Mon D - Mon D YYYY" */
  cross: /^([A-Za-z]{3})\s+\d{1,2}\s*-\s*([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/,
  /** Same-month range: "Mon D-D YYYY" */
  range: /^([A-Za-z]{3})\s+\d{1,2}-(\d{1,2})\s+(\d{4})$/,
  /** Single day: "Mon D YYYY" */
  single: /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})$/,
} as const;

/**
 * The FUZZY form: a month and a year with no day.
 *
 * Anchored, and the month is an explicit alternation rather than
 * `([A-Za-z]{3})[a-z]*`, because both looser shapes were measurably wrong in a
 * function named `…End`:
 *   - unanchored, it matched leftmost, so "Dec 2025 - Jan 2026" returned
 *     2025-12-15 — the START of the range — and non-null, so the row stayed in
 *     scoring with a `daysBefore` that is wrong in the "polled earlier than it
 *     did" direction;
 *   - `[a-z]*` accepted any suffix, so "Mayor 2026" resolved to May.
 * Both now return null. Verified against the committed corpus: 0 rows change.
 */
const FUZZY_FORM =
  /^(?:[A-Za-z]+\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})$/i;

/**
 * Normalise a fieldwork string before matching.
 *
 * En/em dashes fold to an ASCII hyphen because the upstream sources use them —
 * `scrape_polls.ts` has always done exactly this before writing, and the UI's
 * own (now retired) parser accepted `[-–]`. A reader stricter than both writers
 * loses the poll SILENTLY: it renders and sorts in the UI and never enters
 * scoring. Non-breaking spaces fold for the same reason.
 */
const normaliseFieldwork = (fw: string): string =>
  fw
    .replace(/[–—]/g, "-")
    .replace(/\u00A0/g, " ")
    .trim();

/**
 * Parse the END date of a fieldwork string.
 *
 * Accepted forms, all of which the corpus contains:
 *   "Mar 12-20 2026"       → 2026-03-20   (same-month range)
 *   "Feb 23 - Mar 2 2026"  → 2026-03-02   (cross-month range)
 *   "Mar 19 2026"          → 2026-03-19   (single day)
 *   "through Mar 2 2026"   → 2026-03-02   (end known, start not)
 *   "Mar 2024"             → 2024-03-15   (FUZZY — mid-month fallback)
 *
 * ⚠️ The fuzzy fallback is READ-ONLY history. It exists for re-imported seed
 * data (the izboriai import carried month-only fieldwork), not for anything on
 * disk: measured 2026-09-07, **0 of 124** corpus rows resolve through it. No
 * writer may emit it — a poll dated to the 15th because nobody recorded the
 * real day is a fabricated `daysBefore`, and `formatFieldwork` cannot produce
 * one. `isFuzzyFieldwork` is how a gate tells an inherited row from a newly
 * written one.
 *
 * It does NOT calendar-validate, so "Feb 30 2026" yields "2026-02-30".
 * Validation belongs on the writer (`formatFieldwork` throws), because
 * tightening the reader would retroactively unscore corpus rows.
 */
export const parseFieldworkEnd = (fw: string): string | null => {
  const s = normaliseFieldwork(fw);
  const iso = (y: string, monthIdx: number, d: string) =>
    `${y}-${String(monthIdx + 1).padStart(2, "0")}-${d.padStart(2, "0")}`;

  let m = s.match(EXACT_FORMS.through);
  if (m) {
    const mo = MONTH_EN[m[1].toLowerCase()];
    return mo === undefined ? null : iso(m[3], mo, m[2]);
  }
  m = s.match(EXACT_FORMS.cross);
  if (m) {
    const mo = MONTH_EN[m[2].toLowerCase()];
    return mo === undefined ? null : iso(m[4], mo, m[3]);
  }
  m = s.match(EXACT_FORMS.range);
  if (m) {
    const mo = MONTH_EN[m[1].toLowerCase()];
    return mo === undefined ? null : iso(m[3], mo, m[2]);
  }
  m = s.match(EXACT_FORMS.single);
  if (m) {
    const mo = MONTH_EN[m[1].toLowerCase()];
    return mo === undefined ? null : iso(m[3], mo, m[2]);
  }
  m = s.match(FUZZY_FORM);
  if (m) {
    const mo = MONTH_EN[m[1].toLowerCase().slice(0, 3)];
    return mo === undefined
      ? null
      : `${m[2]}-${String(mo + 1).padStart(2, "0")}-15`;
  }
  return null;
};

/**
 * The fieldwork END as epoch milliseconds (UTC), or null when the string is
 * unreadable.
 *
 * Lives here rather than beside its first caller because every list of polls
 * needs the same sort key, and the presidential list will need it next — a
 * per-screen copy is how `AgencyPollsList` ended up with a parser that
 * disagreed with the scorer.
 *
 * NULL rather than a `0` sentinel: callers want different things from
 * "unknown". A sort must place the row (`?? -Infinity` puts it last in a
 * newest-first list); a "which election was this poll predicting" lookup must
 * decline to guess. Collapsing both into `0` made an unreadable poll claim
 * 1970, which only looked right because the list happened to be descending.
 */
export const fieldworkEndMs = (fieldwork: string): number | null => {
  const end = parseFieldworkEnd(fieldwork);
  return end === null ? null : Date.parse(`${end}T00:00:00Z`);
};

/**
 * Sorts a list of polls newest-fieldwork-first, with an unreadable fieldwork
 * sorted to the bottom rather than to 1970 (see `fieldworkEndMs`'s own header).
 * Lives here — not beside any one caller — because every poll-list view
 * (parliamentary and presidential) needs the identical comparator; a
 * per-screen copy is exactly how `AgencyPollsList` used to disagree with
 * itself, the same reason `localizeFieldwork` above is shared rather than
 * copied.
 */
export const sortByFieldworkDesc = <T extends { fieldwork: string }>(
  items: T[],
): T[] =>
  [...items].sort(
    (a, b) =>
      (fieldworkEndMs(b.fieldwork) ?? -Infinity) -
      (fieldworkEndMs(a.fieldwork) ?? -Infinity),
  );

/**
 * True when the string only resolves through the mid-month fallback — i.e. the
 * day is invented rather than recorded.
 *
 * Decided by ELIMINATION over `EXACT_FORMS` itself, so it cannot drift from the
 * parser's vocabulary: whatever the parser reads exactly is not fuzzy, and
 * anything else that still parses reached the fuzzy branch.
 */
export const isFuzzyFieldwork = (fw: string): boolean => {
  if (parseFieldworkEnd(fw) === null) return false;
  const s = normaliseFieldwork(fw);
  return !Object.values(EXACT_FORMS).some((re) => re.test(s));
};

/**
 * `2026-07-19` → `{ y: 2026, m: 6, d: 19 }`, or null when it is not a real day.
 *
 * Deliberately STRICT about surrounding whitespace: it is the guard behind
 * `pollId`, and a predicate that accepts `"  2026-03-19 "` while the caller
 * interpolates the raw string mints a key no dedupe check can match. Callers
 * normalise at their own boundary.
 */
const parseIso = (iso: string): { y: number; m: number; d: number } | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  // Calendar check: Date rolls 2026-02-30 forward to March, so a round-trip
  // that changes the day means the input was not a real date.
  const probe = new Date(Date.UTC(y, mo, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo) return null;
  if (probe.getUTCDate() !== d) return null;
  return { y, m: mo, d };
};

/** True for a syntactically and calendrically real `YYYY-MM-DD`, untrimmed. */
export const isRealIsoDate = (iso: string): boolean => parseIso(iso) !== null;

/**
 * Write the canonical `fieldwork` string for a poll — the one writer, shared
 * with `scripts/polls/scrape_polls.ts`.
 *
 * `startIso` may be null when the agency published an end date (or a
 * publication date) without a range; that yields the "through …" form, which
 * the corpus already uses for exactly that case.
 *
 * ⚠️ The "through" form pads its day (`through Jul 05 2021`) and the other
 * three do not (`Feb 27 - Mar 3 2024`, `Mar 19 2026`). That asymmetry is the
 * committed corpus's, not a preference — `polls_corpus.test.ts` re-emits every
 * stored string through this function and requires byte-identity, so changing
 * either half means migrating the data in the same commit.
 *
 * THROWS on an input it cannot represent (a non-date, an impossible day, an end
 * before the start, or a range spanning two years), because the alternative is
 * minting a poll id from a string the parser will read as something else — and
 * that id is what dedupes the corpus.
 */
export const formatFieldwork = (
  startIso: string | null,
  endIso: string,
): string => {
  const end = parseIso(endIso.trim());
  if (!end) throw new Error(`formatFieldwork: not a real date: "${endIso}"`);
  const endMonth = MONTH_EN_SHORT[end.m];

  if (startIso === null)
    return `through ${endMonth} ${String(end.d).padStart(2, "0")} ${end.y}`;

  const start = parseIso(startIso.trim());
  if (!start)
    throw new Error(`formatFieldwork: not a real date: "${startIso}"`);
  if (Date.UTC(start.y, start.m, start.d) > Date.UTC(end.y, end.m, end.d))
    throw new Error(
      `formatFieldwork: fieldwork ends before it starts (${startIso} → ${endIso})`,
    );
  // A range that spans a year boundary cannot be written in any accepted form
  // (they all carry ONE year), so it is refused rather than silently truncated.
  if (start.y !== end.y)
    throw new Error(
      `formatFieldwork: range spans two years (${startIso} → ${endIso}); ` +
        `the fieldwork vocabulary carries one year`,
    );

  if (start.m === end.m && start.d === end.d)
    return `${endMonth} ${end.d} ${end.y}`;
  if (start.m === end.m) return `${endMonth} ${start.d}-${end.d} ${end.y}`;
  return `${MONTH_EN_SHORT[start.m]} ${start.d} - ${endMonth} ${end.d} ${end.y}`;
};

/**
 * Localised display of a stored fieldwork string. The data is always stored
 * in EN-month form ("Mar 13-19 2026", "through Apr 16 2026") so the
 * analyzer can parse it uniformly; for BG readers this translates the
 * "through" prefix. Shared by every poll-list view (parliamentary and
 * presidential) so the two cannot silently disagree on the wording.
 */
export const localizeFieldwork = (fw: string, isBg: boolean): string => {
  if (!isBg) return fw;
  return fw.replace(/^through\s+/i, "до ");
};

/**
 * The poll id contract: `<agency, lowercased>-<fieldwork end ISO>`.
 *
 * One definition because it is asserted in more than one place — the scraper
 * mints ids with it, and `polls_corpus.test.ts` re-derives them. (The `accept`
 * step that will refuse to overwrite an existing id does not exist yet.)
 *
 * Both inputs are normalised BEFORE validation and interpolation, and the
 * agency is checked against the shape an id can be split on: a guard that
 * validated a trimmed value and then built the key from the raw one produced
 * `"ml-  2026-03-19 "`, which no dedupe check can match against the stored
 * `"ml-2026-03-19"` — so the duplicate would be written rather than refused.
 */
export const pollId = (agencyId: string, endIso: string): string => {
  const end = endIso.trim();
  if (!isRealIsoDate(end))
    throw new Error(`pollId: not a real date: "${endIso}"`);
  const agency = agencyId.trim().toLowerCase();
  // An id is `<agency>-<ISO>`; an agency carrying a separator, whitespace or
  // nothing at all makes the id unsplittable. Every agency in
  // `data/polls/agencies.json` satisfies this shape.
  if (!/^[a-z0-9]+$/.test(agency))
    throw new Error(`pollId: not a usable agency id: "${agencyId}"`);
  return `${agency}-${end}`;
};
