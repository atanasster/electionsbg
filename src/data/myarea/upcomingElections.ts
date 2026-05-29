// Shared list of forward-looking electoral anchors used by both
// MyAreaUpcomingBallotTile and the MyAreaActionBand selector.
//
// These are hand-curated *anchors*: confidence "estimated" means the
// date is a placeholder pegged to the constitutional term; the moment
// the actual decree is published we swap in the real ISO date and set
// confidence to "scheduled". Sort ascending by date.

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
  { date: "2026-11-08", kind: "presidential", confidence: "estimated" },
  { date: "2027-10-24", kind: "local", confidence: "estimated" },
  { date: "2029-06-06", kind: "european", confidence: "estimated" },
];

export const daysUntil = (iso: string): number => {
  const target = new Date(iso + "T00:00:00Z").getTime();
  const now = Date.now();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
};

export const formatLongDate = (iso: string, lang: "bg" | "en"): string => {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
};

/** Closest future event in UPCOMING_ELECTIONS (or null if list is empty). */
export const nextElection = (
  list: UpcomingElection[] = UPCOMING_ELECTIONS,
): UpcomingElection | null => {
  const future = list.filter((e) => daysUntil(e.date) >= 0);
  if (future.length === 0) return null;
  return future.sort((a, b) => a.date.localeCompare(b.date))[0];
};

/** True when a local election sits within the next 365 days — matches
 * the visibility rule of MyAreaUpcomingBallotTile so callers can drop
 * the side column when the tile would render empty. */
export const hasUpcomingLocalBallot = (
  list: UpcomingElection[] = UPCOMING_ELECTIONS,
): boolean =>
  list.some((e) => {
    if (e.kind !== "local") return false;
    const d = daysUntil(e.date);
    return d >= 0 && d <= 365;
  });
