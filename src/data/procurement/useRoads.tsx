// Data hook for the АПИ road-spending dashboard (/procurement/roads) —
// DB-backed. The full per-contract row set comes from /api/db/awarder-contracts
// (АПИ ≈ 2.1k rows) and feeds the pure roadAttributes engine; the headline
// rollup (totals + byContractor) is derived from the same rows plus the
// grouped counterparty list, so no static JSON shard is involved.
//
// The section-wide procurement scope (?pscope — this parliament / all years /
// one calendar year) is applied CLIENT-SIDE here: the awarder-contracts query
// fetches the whole corpus once (cached), and the [from, to) window from
// useScopeWindow simply filters the rows before they reach
// buildRoadsModel. Windowing the already-loaded ~2.1k rows keeps scope switches
// instant (no refetch) and matches the overview's half-open [from, to) on the
// contract `date`. The headline rollup is derived from the SAME windowed rows
// so every number on the page re-scopes together.

import { useMemo } from "react";
import { useCounterparties } from "./useCounterparties";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import {
  useAwarderContracts,
  scopeByWindow,
  type ScopeWindow,
} from "./useAwarderContracts";
import {
  buildRoadsModel,
  API_EIK,
  type RoadsModel,
} from "@/lib/roadAttributes";
import type { ProcurementContract } from "@/data/dataTypes";

// Re-exported so existing importers keep their path. The corpus hook + window
// type live in the buyer-agnostic useAwarderContracts module; each pack takes the
// neutral `ScopeWindow` from its own hook.
export { API_EIK, useAwarderContracts };
export type { ScopeWindow };

/** The slice of the old awarder rollup the roads dashboard actually renders. */
export interface RoadsRollup {
  eik: string;
  name: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  byContractor: Array<{
    eik: string;
    name: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
}

export interface RoadsData {
  rollup: RoadsRollup | null | undefined;
  model: RoadsModel | null;
  isLoading: boolean;
}

export const useRoads = (
  eik: string = API_EIK,
  windowOverride?: ScopeWindow,
): RoadsData => {
  const counterparties = useCounterparties(eik, "awarder");
  const contracts = useAwarderContracts(eik);
  const urlWindow = useScopeWindow();
  const from = windowOverride ? windowOverride.from : urlWindow.from;
  const to = windowOverride ? windowOverride.to : urlWindow.to;

  // Apply the active scope window client-side: keep the corpus fetch cached and
  // just filter the rows to [from, to) on the contract `date` (half-open, same
  // as procurement_overview). "all" leaves from/to null → the whole corpus.
  const scopedContracts = useMemo<ProcurementContract[] | null>(() => {
    const all = contracts.data?.contracts;
    if (!all) return null;
    return scopeByWindow(all, from, to);
  }, [contracts.data, from, to]);

  const model = useMemo(
    () => (scopedContracts ? buildRoadsModel(scopedContracts) : null),
    [scopedContracts],
  );

  // Headline rollup DERIVED from the same windowed rows so the totals, the
  // contractor list (MP-tie section) and every tile re-scope together. Filters
  // tag='contract' to reproduce the company-counterparties aggregate exactly on
  // the "all" window (contractCount can be 0 for a sparse scope — the screen
  // renders a scope-aware empty state, not a broken dashboard). The counterparty
  // list is kept only for the canonical (most-frequent) awarder display name.
  const rollup = useMemo<RoadsRollup | null>(() => {
    if (!scopedContracts) return null;
    const byMap = new Map<string, RoadsRollup["byContractor"][number]>();
    const totalOther: Record<string, number> = {};
    let totalEur = 0;
    let contractCount = 0;
    for (const c of scopedContracts) {
      if (c.tag !== "contract") continue;
      totalEur += c.amountEur ?? 0;
      contractCount += 1;
      if (c.amountEur == null && c.amount != null && c.currency)
        totalOther[c.currency] = (totalOther[c.currency] ?? 0) + c.amount;
      const ceik = c.contractorEik;
      if (!ceik) continue;
      let e = byMap.get(ceik);
      if (!e) {
        e = {
          eik: ceik,
          name: c.contractorName || `ЕИК ${ceik}`,
          totalEur: 0,
          totalOther: {},
          contractCount: 0,
        };
        byMap.set(ceik, e);
      }
      e.totalEur += c.amountEur ?? 0;
      e.contractCount += 1;
      if (c.amountEur == null && c.amount != null && c.currency)
        e.totalOther[c.currency] = (e.totalOther[c.currency] ?? 0) + c.amount;
    }
    return {
      eik,
      name: counterparties.data?.name ?? `ЕИК ${eik}`,
      totalEur,
      totalOther,
      contractCount,
      byContractor: [...byMap.values()].sort((a, b) => b.totalEur - a.totalEur),
    };
  }, [scopedContracts, counterparties.data, eik]);

  return {
    rollup,
    model,
    isLoading: counterparties.isLoading || contracts.isLoading,
  };
};
