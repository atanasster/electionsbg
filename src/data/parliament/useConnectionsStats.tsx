import { useQuery } from "@tanstack/react-query";
import type { ConnectionsStatsFile } from "@/data/dataTypes";

const queryFn = async (): Promise<ConnectionsStatsFile | undefined> => {
  const response = await fetch(`/parliament/connections-stats.json`);
  if (!response.ok) return undefined;
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
