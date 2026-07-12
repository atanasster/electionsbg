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
import { useAwarderGroupModel, type ScopeWindow } from "./useAwarderGroupModel";
import { useJudiciaryBudget } from "@/data/budget/useBudget";
import {
  buildVssModelFromAggregates,
  VSS_EIK,
  type VssModel,
} from "@/lib/vssAttributes";
import { VSS_ALIAS_EIKS } from "@/lib/vssReferenceData";
import type { JudiciaryBudgetFile } from "@/data/budget/types";

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
  const gm = useAwarderGroupModel(
    eiks,
    buildVssModelFromAggregates,
    windowOverride,
  );
  const budget = useJudiciaryBudget();

  // What the alias registrations added, in scope — the per-unit rollup carries
  // each EIK's contract €, so the alias € is the group minus the principal.
  const aliasEur = useMemo(
    () =>
      gm.byUnit
        .filter((u) => u.eik !== eik)
        .reduce((a, u) => a + u.totalEur, 0),
    [gm.byUnit, eik],
  );

  return {
    model: gm.model,
    budget: budget.data ?? null,
    aliasEur,
    isLoading: gm.isLoading || budget.isLoading,
  };
};
