// Budget-law line linkage for a project file (§10 Phase 3, Tier C).
//
// A curated `announcedBudget` is a hand-entered, sourced figure. When the file also
// carries `announcedBudget.budgetLine = { fiscalYear, projectId }`, this resolves it
// to the matching capital line in data/budget/investment_program/<year>.json
// (ЗДБ Приложение III), so the announced number is *sourced against the budget law*
// itself — the reader sees the exact line item + its own amount + the DV source PDF,
// not just our word for it. Pure + deterministic; no match → null (caller hides it).
//
// Note: the committed investment-program payload lists the municipal Приложение III
// capital projects (its `topProjects`). A national АПИ road programme (e.g. Хемус)
// is a *different* budget line and will not match here — that file simply carries no
// sourced-line caption, which is honest, not a bug.

/** One capital project as published in investment_program/<year>.json `topProjects`. */
export interface InvestmentProgramProject {
  projectId: string;
  name: string;
  category?: string;
  oblastCode?: string;
  cost?: { amountEur?: number };
}

/** The (subset of the) investment-program payload this resolver reads. */
export interface InvestmentProgram {
  fiscalYear: number;
  source?: { url?: string };
  topProjects?: InvestmentProgramProject[];
}

export interface ResolvedBudgetLine {
  projectId: string;
  name: string;
  amountEur?: number;
  fiscalYear: number;
  sourceUrl?: string;
  /** Human-readable citation, e.g. "ЗДБ 2025, Приложение III". */
  basis: string;
}

/**
 * Coerce an untrusted `fiscalYear` (from a DIY ?q= spec) to a safe integer year, or
 * undefined. This is the barrier that keeps a hostile value out of the
 * investment_program/<year>.json fetch URL — a non-integer, out-of-range, or
 * non-number (e.g. a "../../" traversal string) resolves to undefined, which
 * disables the fetch. Pure + exported so the guard has explicit regression tests.
 */
export const safeFiscalYear = (y: unknown): number | undefined =>
  typeof y === "number" && Number.isInteger(y) && y >= 2000 && y <= 2100
    ? y
    : undefined;

/**
 * Resolve a curated budget-line reference to its investment-program entry, or null
 * when there is nothing to link (no reference, no payload, or no matching projectId).
 */
export function resolveBudgetLine(
  budgetLine: { fiscalYear: number; projectId?: string } | undefined,
  program: InvestmentProgram | null | undefined,
): ResolvedBudgetLine | null {
  if (!budgetLine?.projectId || !program?.topProjects) return null;
  const hit = program.topProjects.find(
    (p) => p.projectId === budgetLine.projectId,
  );
  if (!hit) return null;
  return {
    projectId: hit.projectId,
    name: hit.name,
    amountEur: hit.cost?.amountEur,
    fiscalYear: program.fiscalYear,
    sourceUrl: program.source?.url,
    basis: `ЗДБ ${program.fiscalYear}, Приложение III`,
  };
}
