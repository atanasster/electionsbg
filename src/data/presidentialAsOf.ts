// Which presidential cycle to show, given the selected parliamentary election date.
//
// ⚠ THE PRESIDENCY IS ANCHORED IN TIME, exactly as local government is (`localAsOf.ts`),
// and for the same reason: a reader who has selected the 2013 parliamentary vote and clicks
// through to „the presidential result" must not be handed 2021. That is the silent
// disagreement the elections hub's own §3.2 is about — the page says one date and the
// destination is about another, at a 200.
//
// ⚠ THE ANCHOR IS ROUND 1's DATE, NOT THE RUNOFF'S, and the difference is a real week. A
// parliamentary vote held between the two rounds falls inside a presidential election that
// has begun and not finished; anchoring on round 1 says „this is the election under way",
// which is the true statement. Anchoring on the runoff would name the PREVIOUS president
// for that week, which is also true of the office and false of the election — and the tile
// links to an election, not to an office-holder.
//
// Pure — no React — so the rule is testable without mounting anything.
//
// Plan: docs/plans/presidential-elections-v1.md T4.4.

import catalogue from "./json/presidential_elections.json";
import type { PresidentialElectionEntry } from "./presidentialCatalogue";

export type PresidentialAsOf = {
  /** The resolved cycle folder id. */
  cycle: string;
  round1Date: string;
  round2Date: string | null;
  /**
   * True when the selected date precedes every catalogued cycle, so this clamped to the
   * oldest rather than returning nothing.
   *
   * ⚠ THE FUNCTION REPORTS IT; NO CONSUMER READS IT YET. `ElectionsHubScreen` takes
   * `.cycle` only, so today a clamped result is exactly as silent on the page as it would
   * be without this field — and nothing can reach it anyway while the presidential corpus
   * starts in 2001 and the parliamentary one in 2005. It exists so a surface CAN say it,
   * rather than presenting 2001 as „the presidency in effect in 1997".
   */
  clampedToOldest: boolean;
};

/** Newest first, so the first hit walking down is the latest applicable. */
const CYCLES: PresidentialElectionEntry[] = (
  catalogue as PresidentialElectionEntry[]
)
  .slice()
  .sort((a, b) => b.round1Date.localeCompare(a.round1Date));

/**
 * `2013_05_12` → `2013-05-12`, and an ISO date through unchanged.
 *
 * ⚠ IT ACCEPTS BOTH ON PURPOSE. The caller holds a resolved hub cycle, which carries an
 * ISO `date` for every KIND — and a reader who selected a LOCAL cycle is standing at a
 * point in time just as much as one who selected a parliamentary one. Taking only a
 * parliamentary id forced the caller to pass `undefined` for the other kinds, and
 * `undefined` means „the newest", which is not a point in time at all.
 */
const toIso = (d?: string): string | undefined =>
  d ? d.replace(/_/g, "-") : undefined;

const at = (
  e: PresidentialElectionEntry,
  clamped: boolean,
): PresidentialAsOf => ({
  cycle: e.name,
  round1Date: e.round1Date,
  round2Date: e.round2Date,
  clampedToOldest: clamped,
});

/**
 * The presidential cycle in effect as of a selected parliamentary election.
 *
 * @param selectedDate - A cycle id (`2013_05_12`, `2019_10_27_mi`) or an ISO date
 *   (`2019-10-27`), or nothing for „the newest". ⚠ A suffixed id works because the suffix
 *   sorts after the date it follows („2019-10-27-mi" > „2019-10-27"), so it lands on the
 *   same side of every comparison — but the DATE is the value to pass when you have it.
 * @returns The newest cycle when nothing is selected; otherwise the most recent one whose
 *   first round had been held by then, clamping to the oldest with `clampedToOldest`.
 */
export const presidentialAsOf = (selectedDate?: string): PresidentialAsOf => {
  const asOf = toIso(selectedDate);
  if (!asOf) return at(CYCLES[0], false);
  const match = CYCLES.find((e) => e.round1Date <= asOf);
  return match ? at(match, false) : at(CYCLES[CYCLES.length - 1], true);
};
