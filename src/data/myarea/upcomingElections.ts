// Shared list of forward-looking electoral anchors used by both
// MyAreaUpcomingBallotTile and the MyAreaActionBand selector.
//
// These are hand-curated *anchors*: confidence "estimated" means the
// date is a placeholder pegged to the constitutional term; the moment
// the actual decree is published we swap in the real ISO date and set
// confidence to "scheduled". Sort ascending by date.
//
// ⚠ AN ESTIMATE IS CHECKED AGAINST THE CORPUS, NOT MERELY WRITTEN DOWN.
// `upcomingElections.test.ts` holds a presidential estimate to the cadence the
// five ingested cycles establish — every round 1 has fallen between 22 October
// and 14 November, 1,806 to 1,841 days after the previous one — so a typo'd
// month or year fails rather than sitting on the My-Area tile as a confident
// date. `scheduled` is exempt: a decree outranks a pattern, and the Народно
// събрание sets the day at least 60 days ahead.
//
// ⚠⚠ AND AN ENTRY MUST BE RETIRED WHEN ITS ELECTION IS INGESTED. `nextElection`
// filters on `daysUntil >= 0`, so a past entry does not error — it silently
// stops being returned, and the tile moves on to the next one. The failure that
// leaves is the days BEFORE that: an election already held and catalogued would
// still be advertised as upcoming for as long as its stored date is in the
// future, which is exactly the window a wrong date creates. The gate compares
// this list against `presidential_elections.json` and `local_elections.json`
// for that reason. ⚠ The `european` anchor has no catalogue in this repo and is
// therefore unchecked — an omission with a reason rather than an oversight.
//
// Plan: docs/plans/presidential-elections-v1.md T4.6.

export type UpcomingElectionKind =
  | "parliament"
  | "presidential"
  | "european"
  | "local";

export type UpcomingElection = {
  date: string; // ISO date — "2026-11-08"
  kind: UpcomingElectionKind;
  confidence: "scheduled" | "estimated";
};

export const UPCOMING_ELECTIONS: UpcomingElection[] = [
  // ⚠ STILL AN ESTIMATE as of 2026-09-06 — no decree has been recorded here. When one is
  // published, replace the date with the decreed day and set `confidence: "scheduled"`;
  // nothing else in the file changes, and the cadence gate stands down for a scheduled
  // entry because a decree outranks a pattern.
  { date: "2026-11-08", kind: "presidential", confidence: "estimated" },
  { date: "2027-10-24", kind: "local", confidence: "estimated" },
  { date: "2029-06-06", kind: "european", confidence: "estimated" },
];

/**
 * Whole days from `now` until the UTC midnight of `iso`. Negative once past.
 *
 * ⚠ `now` IS INJECTABLE so a gate can pin a boundary without pinning the calendar — the
 * shape `src/screens/home/daysUntil.ts` already uses. Without it, every test of a window
 * edge has to hard-code a date relative to today, which is a gate that goes red because
 * the calendar advanced rather than because anything is wrong.
 *
 * ⚠ It is NOT that sibling and must not be merged with it: this one parses a bare calendar
 * day forced to UTC midnight and returns a negative for the past; that one parses full
 * timestamps and returns `null`. Two same-named exports with different contracts is a
 * hazard in itself — import-by-autocomplete gets whichever — so the signatures at least
 * agree.
 */
export const daysUntil = (iso: string, now: number = Date.now()): number => {
  const target = new Date(iso + "T00:00:00Z").getTime();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
};

export const formatLongDate = (iso: string, lang: "bg" | "en"): string => {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    // timeZone: "UTC" is load-bearing. The date above is a plain calendar DAY parsed as
    // UTC midnight; formatting it in the viewer's zone renders it a day early for
    // everyone west of UTC — so the label and the URL it belongs to disagree.
    timeZone: "UTC",
  }).format(d);
};

/** Closest future event in UPCOMING_ELECTIONS (or null if list is empty). */
export const nextElection = (
  list: UpcomingElection[] = UPCOMING_ELECTIONS,
  now: number = Date.now(),
): UpcomingElection | null => {
  const future = list.filter((e) => daysUntil(e.date, now) >= 0);
  if (future.length === 0) return null;
  return future.sort((a, b) => a.date.localeCompare(b.date))[0];
};

/** True when a local election sits within the next 365 days — matches
 * the visibility rule of MyAreaUpcomingBallotTile so callers can drop
 * the side column when the tile would render empty. */
export const hasUpcomingLocalBallot = (
  list: UpcomingElection[] = UPCOMING_ELECTIONS,
  now: number = Date.now(),
): boolean =>
  list.some((e) => {
    if (e.kind !== "local") return false;
    const d = daysUntil(e.date, now);
    return d >= 0 && d <= 365;
  });
