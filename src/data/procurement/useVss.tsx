// Data hook for the ВСС (judiciary) sector pack. Same shape as useNoi/useNzok:
// the buyer's full per-contract corpus comes from /api/db/awarder-contracts, is
// windowed CLIENT-SIDE to the host's [from, to) scope, then fed to the pure
// buildVssModel engine. The pack also loads the судебна власт budget as adopted
// in each year's ЗДБРБ (useJudiciaryBudget), so the ВСС's procurement can be set
// against the ~€708M the judiciary actually spends — and, uniquely among the
// packs, against the revenue the judiciary raises itself (съдебни такси cover
// ~11% of its costs).
//
// ALIAS MERGE — why this pack fans out over more than one EIK. The ВСС is
// registered twice in the procurement corpus: 121513231, and 181092349 for the
// 2024 interim mandate ("Съдийската колегия на ВСС, изпълняваща функциите на
// ВСС", пар. 23 ПЗР на ЗИД на КРБ). They are one institution. A pack titled
// "Съдебна власт (ВСС)" that reported only the first would understate the
// institution's procurement by ~€7.2M (~9%) — so we fetch both and merge before
// the model is built. See VSS_ALIAS_EIKS in src/lib/vssReferenceData.ts.
//
// NB the generic awarder header ABOVE this pack is a per-EIK DB rollup and shows
// 121513231 only; the pack says so in its footnote rather than letting the two
// figures silently disagree.
//
// The budget breakdown is ANNUAL (its own fiscal-year axis) and deliberately
// does NOT honour the procurement scope pill — the pill's parliament window
// straddles calendar years, which is meaningless for a fiscal-year budget. The
// pack picks the budget year itself; procurement re-scopes with the page.

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  awarderContractsQuery,
  scopeByWindow,
  type ScopeWindow,
} from "./useAwarderContracts";
import { useProcurementWindow } from "./useProcurementWindow";
import { useJudiciaryBudget } from "@/data/budget/useBudget";
import { buildVssModel, VSS_EIK, type VssModel } from "@/lib/vssAttributes";
import { VSS_ALIAS_EIKS } from "@/lib/vssReferenceData";
import type { JudiciaryBudgetFile } from "@/data/budget/types";
import type { ProcurementContract } from "@/data/dataTypes";

export { VSS_EIK };
// The pack takes its scope-window type from here.
export type { ScopeWindow };

export interface VssData {
  model: VssModel | null;
  budget: JudiciaryBudgetFile | null;
  /** € carried by the alias registrations, inside the current scope window. The
   *  pack footnotes this so the reader can reconcile the pack against the
   *  per-EIK header above it. */
  aliasEur: number;
  isLoading: boolean;
}

export const useVss = (
  eik: string = VSS_EIK,
  windowOverride?: ScopeWindow,
): VssData => {
  // Only the ВСС's own page merges its aliases; if this pack is ever mounted on
  // another EIK, that EIK stands alone.
  const eiks = useMemo(
    () => (eik === VSS_EIK ? [eik, ...VSS_ALIAS_EIKS] : [eik]),
    [eik],
  );
  // `combine` is what makes the memos below work. Without it useQueries returns a
  // NEW array on every render, so `rows` and `aliasEur` — which depend on it —
  // would recompute on every render of the subtree (a hover that changes a
  // tooltip's state is enough), running the full buildVssModel aggregation twice.
  // react-query memoizes the combined value, so the identities are stable.
  //
  // The principal EIK must have loaded; a missing alias corpus (404, or the EIK
  // simply not present in this deployment's data) degrades to the un-merged
  // total rather than blanking the pack.
  const { rows, aliasRows, isLoading } = useQueries({
    queries: eiks.map((e) => awarderContractsQuery(e)),
    combine: (res) => ({
      rows: res[0]?.data
        ? res.flatMap((r) => r.data?.contracts ?? [])
        : (null as ProcurementContract[] | null),
      aliasRows: res[0]?.data
        ? res.slice(1).flatMap((r) => r.data?.contracts ?? [])
        : [],
      isLoading: res.some((r) => r.isLoading),
    }),
  });
  const budget = useJudiciaryBudget();
  const urlWindow = useProcurementWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;

  const model = useMemo<VssModel | null>(() => {
    if (!rows) return null;
    return buildVssModel(scopeByWindow(rows, from, to));
  }, [rows, from, to]);

  // What the merge added, in scope — for the pack's reconciliation footnote.
  const aliasEur = useMemo(() => {
    if (!aliasRows.length) return 0;
    return buildVssModel(scopeByWindow(aliasRows, from, to)).totalEur;
  }, [aliasRows, from, to]);

  return {
    model,
    budget: budget.data ?? null,
    aliasEur,
    isLoading: isLoading || budget.isLoading,
  };
};
