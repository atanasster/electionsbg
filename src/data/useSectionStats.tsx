import { ElectionInfo } from "./dataTypes";
import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import { useElectionContext } from "./ElectionContext";
import { useMemo } from "react";

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | null | undefined]>): Promise<
  ElectionInfo[]
> => {
  if (!queryKey[1]) {
    return [];
  }
  const response = await fetch(`/sections/${queryKey[1]}_stats.json`);
  const data = await response.json();
  return data;
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
