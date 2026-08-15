// The two basis-critical rules for rendering the ЗБДОО per-fund plan, pulled
// out of BudgetSocialFundsTile so they can be asserted directly.
//
// Both exist because the plan and the B1 execution beside it are on DIFFERENT
// ACCOUNTING BASES. The law's чл. 1 headline is a gross sum of its fund lines
// (they add to it exactly, so no inter-fund transfer was eliminated); the B1
// figures are consolidated cash execution. Anything that invites the reader to
// net one against the other is wrong, however plausible the arithmetic looks.

import type {
  NoiFundPlanFile,
  NoiFundPlanYear,
  NoiFundPlanLine,
} from "@/data/budget/types";

/** The plan for EXACTLY this fiscal year, or null.
 *
 *  Deliberately no latest-year fallback: the plan is a per-year law, so falling
 *  back would print the 2026 ЗБДОО under a "2019" heading, which reads as a
 *  figure for 2019 rather than as one that does not exist. Absent ⇒ draw
 *  nothing.
 *
 *  THAT IS THIS FUNCTION'S RULE, NOT THE WHOLE POLICY. A caller MAY fall back
 *  to the newest plan — `BudgetSocialFundsScreen` does, because the two corpora
 *  do not overlap at all (B1 execution 2023-2024 against a single 2026 ЗБДОО),
 *  so an exact match renders on no page — but only where the plan's OWN year is
 *  in the heading and the gap is named. Without that label the fallback is
 *  exactly the mislabelling this function refuses. `BudgetSocialFundsTile` has
 *  no room for the caveat and therefore keeps the exact-match rule. */
export const selectFundPlanYear = (
  file: NoiFundPlanFile | null | undefined,
  fiscalYear: number,
): NoiFundPlanYear | null =>
  file?.years.find((y) => y.fiscalYear === fiscalYear) ?? null;

/** The fund lines that may be shown alongside each other.
 *
 *  Excludes the „НОИ" line — administration plus the non-fund payments, ~43% of
 *  the sum. It is not a fund in the sense „Пенсии" is, and rendering it in the
 *  same list makes it the largest entry, which reads as a finding ("НОИ spends
 *  more than the pension fund") rather than as a category error. */
export const peerFundLines = (year: NoiFundPlanYear): NoiFundPlanLine[] =>
  year.lines.filter((l) => l.isPeerFund);
