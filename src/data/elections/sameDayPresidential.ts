// Which presidential cycle shared its day with a local one, and back.
//
// ⚠⚠ THE ANSWER IS A CROSS-LINK, NEVER A MERGE (plan §16 question 5, recommendation taken).
// 2011's local and presidential votes came out of ONE ЦИК bundle and the local tree ignores its
// `президент/` folder — so the two corpora sit beside each other with no route between them, and
// a reader on `/local/2011_10_23_mi` has no way to learn that the presidency was decided the
// same day. Folding the presidential results into the local pages would be worse than the gap:
// the ballots are different, the electorate is the same but the question is not, and every
// per-place figure would then need a qualifier saying which vote it counts.
//
// ⚠ BOTH CATALOGUES, NEVER THE SLUG. `2011_10_23_mi` and `2011_10_23_pvr` do share a prefix, and
// matching on it is the „resolve through a shape" defect this plan corrected elsewhere: it would
// mint a link to a cycle this build does not catalogue the moment a local slug gained a day the
// presidential corpus lacks. Both sides answer from their own committed registry, and the join
// is on the round-1 DATE — which is what „the same day" actually means.
//
// ⚠ ONE MATCH TODAY, AND THE RULE IS NOT WRITTEN FOR ONE. Of the five regular local cycles
// (2007, 2011, 2015, 2019, 2023) only 2011 shares a day. A hard-coded pair would be smaller and
// would go silently wrong the first time the calendar repeats — 2026's presidential decree is
// the live case.
//
// ⚠⚠ PARTIALS ARE OUT OF SCOPE, AND 2016 IS THE CASE THAT PROVES IT IS A DECISION RATHER THAN
// AN ACCIDENT. `data/2016_11_06_chmi` — two kmetstvo-mayor races, Девин/Грохотно and
// Шумен/Друмево — was held on 2016-11-06, the SAME DAY as `2016_11_06_pvr` round 1, and both
// trees are committed. It is excluded because the pill's label says „Местни избори 2016", which
// two by-elections in two villages are not; `local_elections.json` is regular-cycles-only and is
// what enforces it. Saying „the presidential side's other four fall in years with no local vote"
// — which this comment did — was simply false. A future partial on a presidential polling day
// needs a decision, not a widening; `sameDayPresidential.test.ts` fails if one starts matching.

import allLocalElections from "@/data/json/local_elections.json";
import type { LocalElectionEntry } from "@/data/ElectionContext";
import {
  PRESIDENTIAL_CATALOGUE,
  type PresidentialElectionEntry,
} from "@/data/presidentialCatalogue";

// ⚠ THE SHARED DECLARATION, not a third private spelling of the same row. `ElectionContext`
// already types it, `kind` included — which is what makes the partial exclusion above legible as
// a property of the FILE this reads rather than of the type.
const LOCAL_ROWS = allLocalElections as LocalElectionEntry[];

/**
 * The presidential cycle whose first round fell on the same day as `localCycle`.
 *
 * @param localCycle - A local cycle slug, e.g. `2011_10_23_mi`.
 * @returns The catalogue row, or `undefined` — for a slug this build does not catalogue, for a
 *   PARTIAL cycle (see the header), and for the four local cycles with no presidential vote that
 *   day.
 */
export const presidentialSameDayAs = (
  localCycle?: string,
): PresidentialElectionEntry | undefined => {
  const day = LOCAL_ROWS.find((c) => c.name === localCycle)?.round1Date;
  return day
    ? PRESIDENTIAL_CATALOGUE.find((e) => e.round1Date === day)
    : undefined;
};

/**
 * The local cycle whose first round fell on the same day as `presidentialCycle`.
 *
 * @param presidentialCycle - A presidential cycle slug, e.g. `2011_10_23_pvr`.
 * @returns The catalogue row, or `undefined` for the four cycles with no local vote that day.
 */
export const localSameDayAs = (
  presidentialCycle?: string,
): LocalElectionEntry | undefined => {
  const day = PRESIDENTIAL_CATALOGUE.find(
    (e) => e.name === presidentialCycle,
  )?.round1Date;
  return day ? LOCAL_ROWS.find((c) => c.round1Date === day) : undefined;
};
