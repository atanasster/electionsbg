import { ElectionInfo } from "../dataTypes";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { useMemo } from "react";
import { dataUrl } from "@/data/dataUrl";
import { fetchJsonSoft } from "../fetchJson";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  ElectionInfo[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const data = await fetchJsonSoft<ElectionInfo[]>(
    dataUrl(`/sections/${queryKey[1]}_stats.json`),
  );
  return data ?? [];
};
export const useSectionStats = (section?: string | null) => {
  const { priorElections } = useElectionContext();
  const { data: stats } = useQuery({
    queryKey: ["section_stats", section],
    queryFn,
    enabled: !!section,
  });
  const prevVotes = useMemo(() => {
    if (priorElections) {
      return stats?.find((s) => s.name === priorElections.name);
    }
    return undefined;
  }, [priorElections, stats]);
  return {
    stats,
    prevVotes,
  };
};
