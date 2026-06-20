// SPA hook for the per-CPV-division competition baseline. Tiny file (~40
// divisions); fetched once and indexed by division → single-bid share so the
// risk scorer can gate the single-bidder flag in O(1) per contract row.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CpvCompetitionFile } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const fetchCpvCompetition = async (): Promise<CpvCompetitionFile | null> => {
  const response = await fetch(
    dataUrl("/procurement/derived/cpv_competition.json"),
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return (await response.json()) as CpvCompetitionFile;
};

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
  const { data, isLoading } = useQuery({
    queryKey: ["procurement_cpv_competition"] as const,
    queryFn: fetchCpvCompetition,
    staleTime: Infinity,
  });

  const index = useMemo<CpvCompetitionIndex>(() => {
    if (!data) return EMPTY;
    const byDivision = new Map<string, number>();
    for (const d of data.divisions) {
      byDivision.set(d.division, d.singleBidShare);
    }
    return {
      byDivision,
      structuralSingleBidShare: data.structuralSingleBidShare,
    };
  }, [data]);

  return { index, isLoading };
};
