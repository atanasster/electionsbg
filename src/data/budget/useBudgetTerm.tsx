// Election-scoping for the budget pillar.
//
// The budget dashboard is scoped to the selected election (parliament term),
// the same way procurement's per-NS slices are: a term runs from its election
// date to the next election. A term can span several fiscal years — several
// budget laws — so the screen lists every fiscal year overlapping the term
// and lets the user pick which one to drill into (persisted in `?fy=`).

import { useMemo } from "react";
import { useParliamentTerm } from "@/data/parliament/useParliamentTerm";
import { useSearchParam } from "@/screens/utils/useSearchParam";
import type { BudgetIndex, FiscalYearSummary } from "./types";

export interface BudgetTermYear {
  fiscalYear: number;
  // null when no budget data has been ingested for this fiscal year yet.
  summary: FiscalYearSummary | null;
  // True when this year predates the parliament's term but its budget law is
  // still "in effect" because the current term has not yet adopted its own
  // budget law — the prior year's appropriations carry over (продължен бюджет).
  carryover?: boolean;
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
  const { election: selected, termStart, termEnd } = useParliamentTerm();
  const [fyParam, setFyParam] = useSearchParam("fy", { replace: true });

  const years = useMemo<BudgetTermYear[]>(() => {
    if (!termStart) return [];
    const startYear = termStart.getFullYear();
    const endYear = termEnd ? termEnd.getFullYear() : new Date().getFullYear();
    const byYear = new Map(
      (index?.fiscalYears ?? []).map((f) => [f.fiscalYear, f]),
    );
    // A year is "ingested" — and so worth listing — when it carries either a
    // KFP-derived summary OR any law/amendment/execution stage from the
    // document index. Years with only law/execution data (no КФП yet) still
    // back the ministries + journey tiles, so the FY chip should be live.
    const withStages = new Set(
      (index?.years ?? [])
        .filter((y) => y.stages.length > 0)
        .map((y) => y.fiscalYear),
    );
    const adminByYear = new Map(
      (index?.years ?? []).map((y) => [y.fiscalYear, !!y.dimensions?.admin]),
    );
    const out: BudgetTermYear[] = [];
    for (let y = startYear; y <= endYear; y++) {
      const summary = byYear.get(y) ?? null;
      if (summary || withStages.has(y)) {
        out.push({ fiscalYear: y, summary });
      }
    }
    // Carry-over: when the term's latest year has no admin (law) data ingested
    // yet, the prior year's State Budget Law is still in effect ("продължен
    // бюджет"). Prepend the most recent prior year with admin data so users
    // can see the appropriations that actually govern the term right now.
    const latest = out[out.length - 1];
    if (latest && !adminByYear.get(latest.fiscalYear)) {
      const prior = [...(index?.years ?? [])]
        .filter(
          (y) =>
            y.fiscalYear < latest.fiscalYear && y.dimensions?.admin === true,
        )
        .sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
      if (prior && !out.some((o) => o.fiscalYear === prior.fiscalYear)) {
        out.unshift({
          fiscalYear: prior.fiscalYear,
          summary: byYear.get(prior.fiscalYear) ?? null,
          carryover: true,
        });
      }
    }
    return out;
  }, [termStart, termEnd, index]);

  // Years with any ingested data — summary OR a stage. The chip is enabled for
  // these; consumers that need a KFP summary specifically must check `summary`.
  const yearsWithData = useMemo(() => years, [years]);

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
    // picture), falling back to the most recent year with any data. When the
    // term has only a carry-over year + an in-progress year without its own
    // law, prefer the carry-over (its appropriations are what's in effect).
    const lastComplete = [...yearsWithData]
      .reverse()
      .find((y) => y.summary?.complete);
    if (lastComplete) return lastComplete.fiscalYear;
    const latest = yearsWithData[yearsWithData.length - 1];
    const carry = yearsWithData.find((y) => y.carryover);
    if (carry && !latest.summary?.complete && yearsWithData.length <= 2) {
      return carry.fiscalYear;
    }
    return latest.fiscalYear;
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
