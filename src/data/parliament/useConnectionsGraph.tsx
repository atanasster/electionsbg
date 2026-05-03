import { useQuery } from "@tanstack/react-query";
import type { ConnectionsGraph } from "@/data/dataTypes";

const queryFn = async (): Promise<ConnectionsGraph | undefined> => {
  const response = await fetch(`/parliament/connections.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export const useConnectionsGraph = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_connections_graph"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  return { graph: data, isLoading };
};
