// SPA hook for the per-CPV-division competition baseline — DB-backed via the
// shared risk-indexes payload (useRiskIndexes). ~40 divisions, indexed by
// division → single-bid share so the risk scorer can gate the single-bidder
// flag in O(1) per contract row.

import { useMemo } from "react";
import { useRiskIndexes } from "./useRiskIndexes";

export type CpvCompetitionIndex = {
  /** 2-digit CPV division → single-bid share (0..1). */
  byDivision: Map<string, number>;
  /** Share at/above which a division is structurally single-bid. */
  structuralSingleBidShare: number;
};

const EMPTY: CpvCompetitionIndex = {
  byDivision: new Map(),
  structuralSingleBidShare: 0.8,
};

export const useCpvCompetition = (): {
  index: CpvCompetitionIndex;
  isLoading: boolean;
} => {
  const { data, isLoading } = useRiskIndexes();

  const index = useMemo<CpvCompetitionIndex>(() => {
    if (!data) return EMPTY;
    const byDivision = new Map<string, number>();
    for (const d of data.cpvCompetition.divisions) {
      byDivision.set(d.division, d.singleBidShare);
    }
    return {
      byDivision,
      structuralSingleBidShare: data.cpvCompetition.structuralSingleBidShare,
    };
  }, [data]);

  return { index, isLoading };
};
