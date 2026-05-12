import { useQuery } from "@tanstack/react-query";
import type { ConnectionsRankings } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<ConnectionsRankings | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/connections-rankings.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
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
