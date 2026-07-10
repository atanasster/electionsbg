// Data hook for the НОИ (ДОО) sector pack. Same shape as useRoads: the buyer's
// full per-contract corpus comes once from /api/db/awarder-contracts (НОИ ≈ 2.3k
// rows), is windowed CLIENT-SIDE to the host's [from, to) scope, then fed to the
// pure buildNoiModel engine. The pack also fuses the ДОО fund-execution snapshot
// (useNoiFunds — pensions / benefits / Персонал / Издръжка) so the procurement
// ledger can be set against the €12bn fund it sits inside — the differentiator
// no procurement-only portal has.

import { useMemo } from "react";
import {
  useAwarderContracts,
  scopeByWindow,
  type ScopeWindow,
} from "./useAwarderContracts";
import { useProcurementWindow } from "./useProcurementWindow";
import { useNoiFunds } from "@/data/budget/useBudget";
import { buildNoiModel, NOI_EIK, type NoiModel } from "@/lib/noiAttributes";
import type { NoiFundsFile } from "@/data/budget/types";
import { latestCompleteNoiYear } from "@/data/budget/noiYear";

export { NOI_EIK };
// The pack takes its scope-window type from here.
export type { ScopeWindow };

/** The single ДОО fiscal-year snapshot the pack renders (the most recent
 *  ingested year), flattened to the figures the tiles need. Admin = Персонал +
 *  Издръжка executed, summed across the funds НОИ administers. */
export interface NoiFundYear {
  fiscalYear: number;
  expenditureEur: number; // total fund outflow (pensions + benefits + admin …)
  pensionsEur: number;
  benefitsEur: number;
  revenueEur: number; // own contributions (the rest is the state transfer)
  personnelEur: number;
  operationsEur: number;
  adminEur: number; // personnel + operations
  capitalEur: number;
  pensionTypes: NoiFundsFile["years"][number]["pensionTypes"];
}

export interface NoiData {
  model: NoiModel | null;
  fundYear: NoiFundYear | null;
  isLoading: boolean;
}

const flattenFundYear = (file: NoiFundsFile | null): NoiFundYear | null => {
  if (!file || !file.years.length) return null;
  // Latest year carrying real fund detail. Taking the raw max would select the
  // mid-cycle shell and render adminEur/revenue = 0, i.e. a false "0% covered
  // by contributions / 100% state transfer" claim and a vanished admin tile.
  const y = latestCompleteNoiYear(file.years);
  if (!y) return null;
  let personnelEur = 0;
  let operationsEur = 0;
  let capitalEur = 0;
  for (const f of y.funds) {
    for (const l of f.expenseLines) {
      const e = l.executed?.amountEur ?? 0;
      if (l.id === "personnel") personnelEur += e;
      else if (l.id === "operations") operationsEur += e;
      else if (l.id === "capital_assets" || l.id === "capital_transfers")
        capitalEur += e;
    }
  }
  return {
    fiscalYear: y.fiscalYear,
    expenditureEur: y.totals.expenditure.amountEur,
    pensionsEur: y.totals.pensions.amountEur,
    benefitsEur: y.totals.shortTermBenefits.amountEur,
    revenueEur: y.totals.revenue.amountEur,
    personnelEur,
    operationsEur,
    adminEur: personnelEur + operationsEur,
    capitalEur,
    pensionTypes: y.pensionTypes,
  };
};

export const useNoi = (
  eik: string = NOI_EIK,
  windowOverride?: ScopeWindow,
): NoiData => {
  const contracts = useAwarderContracts(eik);
  const funds = useNoiFunds();
  const urlWindow = useProcurementWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;

  const model = useMemo<NoiModel | null>(() => {
    const all = contracts.data?.contracts;
    if (!all) return null;
    return buildNoiModel(scopeByWindow(all, from, to));
  }, [contracts.data, from, to]);

  const fundYear = useMemo(
    () => flattenFundYear(funds.data ?? null),
    [funds.data],
  );

  return {
    model,
    fundYear,
    isLoading: contracts.isLoading || funds.isLoading,
  };
};
