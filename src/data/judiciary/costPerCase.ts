// Derived metric: разход на свършено дело — the courts' own appropriation divided
// by the cases they resolved. Kept SCOPE-MATCHED: the ЗДБРБ line "Съдилища на РБ"
// (courts only) over Приложение № 1 resolved totals (courts only). Both sides
// exclude the prosecution, ВКС and ВАС, so prosecution money is never folded into a
// per-court-case cost — which a naive "total judiciary budget ÷ court cases" does.
//
// Pure join of the two committed artifacts on fiscal year, so the tile, the AI tool
// and the prerender all derive the exact same number from one place.

import type { JudiciaryYear } from "./useCaseload";
import type { JudiciaryBudgetFile } from "@/data/budget/types";

export interface CostPerCasePoint {
  year: number;
  /** Courts' appropriation (Съдилища на РБ) in EUR. */
  courtsEur: number;
  /** Courts' resolved cases that year (Приложение № 1 total). */
  resolved: number;
  /** courtsEur ÷ resolved. */
  eurPerCase: number;
}

/** Ascending by year; only years present in BOTH artifacts with resolved > 0 and a
 *  positive courts appropriation. */
export const costPerResolvedCase = (
  years: JudiciaryYear[],
  budget: JudiciaryBudgetFile,
): CostPerCasePoint[] => {
  const resolvedByYear = new Map(years.map((y) => [y.year, y.total.resolved]));
  const points: CostPerCasePoint[] = [];
  for (const by of budget.years) {
    const courts = by.bodies.find((b) => b.id === "courts");
    const resolved = resolvedByYear.get(by.fiscalYear);
    if (!courts || !resolved || resolved <= 0) continue;
    const courtsEur = courts.amount.amountEur;
    // Guard courtsEur > 0 too: a zero appropriation would give eurPerCase = 0, and if
    // it were the first point the tile's latest/first ratio would be Infinity ("×∞").
    if (courtsEur <= 0) continue;
    points.push({
      year: by.fiscalYear,
      courtsEur,
      resolved,
      eurPerCase: courtsEur / resolved,
    });
  }
  return points.sort((a, b) => a.year - b.year);
};
