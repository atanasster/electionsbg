// Election-scoping for the budget pillar.
//
// The budget dashboard is scoped to the selected election (parliament term),
// the same way procurement's per-NS slices are: a term runs from its election
// date to the next election. A term can span several fiscal years — several
// budget laws — so the screen lists every fiscal year overlapping the term
// and lets the user pick which one to drill into (persisted in `?fy=`).

import { useMemo } from "react";
import { useElectionContext } from "@/data/ElectionContext";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import type { BudgetIndex, FiscalYearSummary } from "./types";

// "2024_10_27" → Date. Returns null for anything that isn't a date name.
const electionDate = (name: string): Date | null => {
  const m = name.match(/^(\d{4})_(\d{2})_(\d{2})$/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}`);
};

export interface BudgetTermYear {
  fiscalYear: number;
  // null when no budget data has been ingested for this fiscal year yet.
  summary: FiscalYearSummary | null;
}

export interface BudgetTerm {
  // The selected election name ("2024_10_27").
  election: string;
  termStart: Date | null;
  termEnd: Date | null; // null for the current (newest) parliament — open-ended
  // Every fiscal year overlapping the term, oldest first.
  years: BudgetTermYear[];
  // Years that actually have data — convenience subset of `years`.
  yearsWithData: BudgetTermYear[];
  // The fiscal year currently drilled into (from `?fy=`, defaulting to the
  // most recent year with data). null when the term has no data at all.
  selectedFy: number | null;
  setSelectedFy: (fy: number) => void;
}

export const useBudgetTerm = (
  index: BudgetIndex | null | undefined,
): BudgetTerm => {
  const { selected, elections } = useElectionContext();
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });

  const { termStart, termEnd } = useMemo(() => {
    const idx = elections.indexOf(selected);
    const start = electionDate(selected);
    // elections is newest-first, so the entry *before* `selected` is the
    // next (newer) election — the end of this term.
    const end = idx > 0 ? electionDate(elections[idx - 1]) : null;
    return { termStart: start, termEnd: end };
  }, [selected, elections]);

  const years = useMemo<BudgetTermYear[]>(() => {
    if (!termStart) return [];
    const startYear = termStart.getFullYear();
    const endYear = termEnd ? termEnd.getFullYear() : new Date().getFullYear();
    const byYear = new Map(
      (index?.fiscalYears ?? []).map((f) => [f.fiscalYear, f]),
    );
    const out: BudgetTermYear[] = [];
    for (let y = startYear; y <= endYear; y++) {
      out.push({ fiscalYear: y, summary: byYear.get(y) ?? null });
    }
    return out;
  }, [termStart, termEnd, index]);

  const yearsWithData = useMemo(
    () =>
      years.filter(
        (y): y is BudgetTermYear & { summary: FiscalYearSummary } =>
          y.summary != null,
      ),
    [years],
  );

  const selectedFy = useMemo<number | null>(() => {
    const requested = fyParam ? parseInt(fyParam, 10) : NaN;
    if (
      Number.isFinite(requested) &&
      yearsWithData.some((y) => y.fiscalYear === requested)
    ) {
      return requested;
    }
    if (yearsWithData.length === 0) return null;
    // Default: the most recent COMPLETE fiscal year (a full plan-vs-actual
    // picture), falling back to the most recent year with any data.
    const lastComplete = [...yearsWithData]
      .reverse()
      .find((y) => y.summary.complete);
    return (lastComplete ?? yearsWithData[yearsWithData.length - 1]).fiscalYear;
  }, [fyParam, yearsWithData]);

  const setSelectedFy = (fy: number): void => setFyParam(String(fy));

  return {
    election: selected,
    termStart,
    termEnd,
    years,
    yearsWithData,
    selectedFy,
    setSelectedFy,
  };
};
