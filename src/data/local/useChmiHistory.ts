// Fetch the per-município chmi history index. Surfaces extraordinary
// elections (partial + new) on the município pages they affected.
//
// Schema mirrors scripts/parsers_local/build_chmi_history.ts ChmiHistory.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { dataUrl } from "@/data/dataUrl";

export type ChmiHistoryEvent = {
  cycle: string;
  date: string;
  kind: "obshtina_mayor" | "kmetstvo_mayor" | "rayon_mayor";
  obshtinaCode: string;
  obshtinaName: string;
  kmetstvoName: string | null;
  candidateName: string;
  localPartyName: string;
  primaryCanonicalId: string | null;
  isIndependent: boolean;
  round: 1 | 2;
  pctOfValid: number;
  votes: number;
  mpId?: number;
};

type ChmiHistory = {
  generatedAt: string;
  cyclesIncluded: string[];
  byObshtina: Record<string, ChmiHistoryEvent[]>;
  allEvents: ChmiHistoryEvent[];
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string]>): Promise<ChmiHistory | undefined> => {
  void queryKey;
  const response = await fetch(dataUrl("/local_chmi_history.json"));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `chmi history fetch failed: ${response.status} ${response.url}`,
    );
  }
  return response.json();
};

export const useChmiHistoryAll = () =>
  useQuery({
    queryKey: ["local_chmi_history"],
    queryFn,
  });

export const useChmiHistory = (
  obshtinaCode?: string | null,
): ChmiHistoryEvent[] => {
  const { data } = useChmiHistoryAll();
  return useMemo(() => {
    if (!data || !obshtinaCode) return [];
    return data.byObshtina[obshtinaCode] ?? [];
  }, [data, obshtinaCode]);
};
