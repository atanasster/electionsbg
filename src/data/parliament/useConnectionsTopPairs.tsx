import { useQuery } from "@tanstack/react-query";
import type { ConnectionsTopPairsFile } from "@/data/dataTypes";

const queryFn = async (): Promise<ConnectionsTopPairsFile | undefined> => {
  const response = await fetch(`/parliament/connections-top-pairs.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export const useConnectionsTopPairs = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_connections_top_pairs"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  return { topPairs: data, isLoading };
};
