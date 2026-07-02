// SPA hook for the awarder→contractor concentration index — DB-backed via the
// shared risk-indexes payload (useRiskIndexes). Indexed by
// `awarderEik|contractorEik` so the risk-flag hook can do an O(1) lookup per
// contract row.

import { useMemo } from "react";
import type { AwarderConcentrationEntry } from "@/data/dataTypes";
import { useRiskIndexes } from "./useRiskIndexes";

export type AwarderConcentrationIndex = {
  /** Lookup key: `${awarderEik}|${contractorEik}` → entry. Returns undefined
   *  when the pair is below the (server-side) threshold; treat missing as
   *  "not concentrated". */
  byPair: Map<string, AwarderConcentrationEntry>;
  thresholdPct: number;
};

const EMPTY: AwarderConcentrationIndex = {
  byPair: new Map(),
  thresholdPct: 0,
};

export const useAwarderConcentration = (): {
  index: AwarderConcentrationIndex;
  isLoading: boolean;
} => {
  const { data, isLoading } = useRiskIndexes();

  const index = useMemo<AwarderConcentrationIndex>(() => {
    if (!data) return EMPTY;
    const byPair = new Map<string, AwarderConcentrationEntry>();
    for (const e of data.concentration.entries) {
      byPair.set(`${e.awarderEik}|${e.contractorEik}`, e);
    }
    return { byPair, thresholdPct: data.concentration.thresholdPct };
  }, [data]);

  return { index, isLoading };
};
