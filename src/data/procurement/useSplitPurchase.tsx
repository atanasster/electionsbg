// Split-purchase pair-years from the shared risk-indexes payload
// (useRiskIndexes → splitPurchase). Backs the splitPurchase risk flag: a
// (buyer, supplier, CPV-div, year) group of all-direct, each-sub-threshold
// awards that together clear the ЗОП чл.20 ал.4 ceiling — a PATTERN consistent
// with splitting, surfaced "for review", not a proven breach. Same
// shape/gating as useAwarderConcentration: an O(1) lookup keyed
// `awarderEik|contractorEik|cpvDiv|year`, undefined ⇒ not part of a split.

import { useMemo } from "react";
import { useRiskIndexes } from "./useRiskIndexes";
import type { SplitPurchaseEntry } from "@/data/dataTypes";

export const useSplitPurchase = (): {
  byKey: Map<string, SplitPurchaseEntry>;
  isLoading: boolean;
} => {
  const { data, isLoading } = useRiskIndexes();
  const byKey = useMemo(() => {
    const m = new Map<string, SplitPurchaseEntry>();
    for (const e of data?.splitPurchase ?? [])
      m.set(`${e.awarderEik}|${e.contractorEik}|${e.cpvDiv}|${e.year}`, e);
    return m;
  }, [data]);
  return { byKey, isLoading };
};
