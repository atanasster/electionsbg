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
import { useAwarderGroupModel, type ScopeWindow } from "./useAwarderGroupModel";
import {
  useNzokBudget,
  useNzokExecution,
  useNzokExecutionHistory,
  useNzokHospitalPayments,
  useNzokHospitalTrends,
  useNzokDrugReimbursement,
} from "@/data/budget/useBudget";
import {
  buildNzokModelFromAggregates,
  NZOK_EIK,
  type NzokModel,
} from "@/lib/nzokAttributes";
import type {
  NzokBudgetFile,
  NzokExecutionFile,
  NzokExecutionHistoryFile,
  NzokHospitalPaymentsFile,
  NzokHospitalTrendsFile,
  NzokDrugReimbursementFile,
} from "@/data/budget/types";

export { NZOK_EIK };
// The pack takes its scope-window type from here.
export type { ScopeWindow };

export interface NzokData {
  model: NzokModel | null;
  budget: NzokBudgetFile | null;
  execution: NzokExecutionFile | null;
  executionHistory: NzokExecutionHistoryFile | null;
  hospitalPayments: NzokHospitalPaymentsFile | null;
  hospitalTrends: NzokHospitalTrendsFile | null;
  drugReimbursement: NzokDrugReimbursementFile | null;
  isLoading: boolean;
}

export const useNzok = (
  eik: string = NZOK_EIK,
  windowOverride?: ScopeWindow,
): NzokData => {
  const eiks = useMemo(() => [eik], [eik]);
  const gm = useAwarderGroupModel(
    eiks,
    buildNzokModelFromAggregates,
    windowOverride,
  );
  const budget = useNzokBudget();
  const execution = useNzokExecution();
  const executionHistory = useNzokExecutionHistory();
  const hospitalPayments = useNzokHospitalPayments();
  const hospitalTrends = useNzokHospitalTrends();
  const drugReimbursement = useNzokDrugReimbursement();

  return {
    model: gm.model,
    budget: budget.data ?? null,
    execution: execution.data ?? null,
    executionHistory: executionHistory.data ?? null,
    hospitalPayments: hospitalPayments.data ?? null,
    hospitalTrends: hospitalTrends.data ?? null,
    drugReimbursement: drugReimbursement.data ?? null,
    // OR in every dataset so the pack paints once, not tile-by-tile (avoids the
    // execution gauge / hospital / drug tiles popping into an already-rendered
    // pack). The contract-corpus fetch dominates the wall clock regardless.
    isLoading:
      gm.isLoading ||
      budget.isLoading ||
      execution.isLoading ||
      executionHistory.isLoading ||
      hospitalPayments.isLoading ||
      hospitalTrends.isLoading ||
      drugReimbursement.isLoading,
  };
};
