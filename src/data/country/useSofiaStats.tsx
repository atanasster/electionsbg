import { ElectionInfo } from "../dataTypes";
import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "../ElectionContext";
import { useMemo } from "react";

const queryFn = async (): Promise<ElectionInfo[]> => {
  const response = await fetch(`/sofia_stats.json`);
  const data = await response.json();
  return data;
};
export const useSofiaStats = () => {
  const { priorElections } = useElectionContext();
  const { data } = useQuery({
    queryKey: ["sofia_stats"],
    queryFn,
  });
  const prevVotes: ElectionInfo | undefined = useMemo(() => {
    if (priorElections) {
      return data?.find((s) => s.name === priorElections.name);
    }
    return undefined;
  }, [priorElections, data]);
  return {
    sofiaStats: data,
    prevVotes,
  };
};
