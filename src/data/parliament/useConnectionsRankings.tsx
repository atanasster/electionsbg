import { useQuery } from "@tanstack/react-query";
import type { ConnectionsRankings } from "@/data/dataTypes";

const queryFn = async (): Promise<ConnectionsRankings | undefined> => {
  const response = await fetch(`/parliament/connections-rankings.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export const useConnectionsRankings = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_connections_rankings"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  return { rankings: data, isLoading };
};
