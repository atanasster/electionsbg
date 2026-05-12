import { useQuery } from "@tanstack/react-query";
import type { ConnectionsStatsFile } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<ConnectionsStatsFile | undefined> => {
  const response = await fetch(dataUrl(`/parliament/connections-stats.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useConnectionsStats = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_connections_stats"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  return { stats: data, isLoading };
};
