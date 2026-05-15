// SPA hook for the awarder→contractor concentration index. Loaded once and
// indexed by `awarderEik|contractorEik` so the risk-flag hook can do an O(1)
// lookup per contract row without re-walking the file.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  AwarderConcentrationEntry,
  AwarderConcentrationFile,
} from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const fetchConcentration =
  async (): Promise<AwarderConcentrationFile | null> => {
    const response = await fetch(
      dataUrl("/procurement/derived/awarder_concentration.json"),
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`fetch failed: ${response.status} ${response.url}`);
    }
    return (await response.json()) as AwarderConcentrationFile;
  };

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
  const { data, isLoading } = useQuery({
    queryKey: ["procurement_awarder_concentration"] as const,
    queryFn: fetchConcentration,
    staleTime: Infinity,
  });

  const index = useMemo<AwarderConcentrationIndex>(() => {
    if (!data) return EMPTY;
    const byPair = new Map<string, AwarderConcentrationEntry>();
    for (const e of data.entries) {
      byPair.set(`${e.awarderEik}|${e.contractorEik}`, e);
    }
    return { byPair, thresholdPct: data.thresholdPct };
  }, [data]);

  return { index, isLoading };
};
