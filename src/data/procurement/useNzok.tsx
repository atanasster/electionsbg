// Data hook for the НЗОК (health) sector pack. Same shape as useNoi/useRoads:
// the buyer's full per-contract corpus comes once from /api/db/awarder-contracts
// (НЗОК ≈ 1.4k rows), is windowed CLIENT-SIDE to the host's [from, to) scope,
// then fed to the pure buildNzokModel engine. The pack also loads НЗОК's annual
// budget-law breakdown (useNzokBudget) so the ~€79M of procurement can be set
// against the ~€5.5bn the fund actually spends — the ~98.5% that flows OUTSIDE
// public procurement (hospital reimbursements, drug reimbursement, GP/dental).
//
// The budget breakdown is ANNUAL (its own fiscal-year axis) and deliberately
// does NOT honour the procurement scope pill — the pill's parliament window
// straddles calendar years, which is meaningless for a fiscal-year budget. The
// pack picks the budget year itself; procurement re-scopes with the page.

import { useMemo } from "react";
import {
  useAwarderContracts,
  scopeByWindow,
  type ScopeWindow,
} from "./useAwarderContracts";
import { useProcurementWindow } from "./useProcurementWindow";
import {
  useNzokBudget,
  useNzokHospitalPayments,
} from "@/data/budget/useBudget";
import { buildNzokModel, NZOK_EIK, type NzokModel } from "@/lib/nzokAttributes";
import type {
  NzokBudgetFile,
  NzokHospitalPaymentsFile,
} from "@/data/budget/types";

export { NZOK_EIK };
// Back-compat alias so the pack takes its scope-window type from here.
export type RoadsWindow = ScopeWindow;

export interface NzokData {
  model: NzokModel | null;
  budget: NzokBudgetFile | null;
  hospitalPayments: NzokHospitalPaymentsFile | null;
  isLoading: boolean;
}

export const useNzok = (
  eik: string = NZOK_EIK,
  windowOverride?: RoadsWindow,
): NzokData => {
  const contracts = useAwarderContracts(eik);
  const budget = useNzokBudget();
  const hospitalPayments = useNzokHospitalPayments();
  const urlWindow = useProcurementWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;

  const model = useMemo<NzokModel | null>(() => {
    const all = contracts.data?.contracts;
    if (!all) return null;
    return buildNzokModel(scopeByWindow(all, from, to));
  }, [contracts.data, from, to]);

  return {
    model,
    budget: budget.data ?? null,
    hospitalPayments: hospitalPayments.data ?? null,
    isLoading: contracts.isLoading || budget.isLoading,
  };
};
