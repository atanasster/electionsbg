import { useQuery } from "@tanstack/react-query";
import type { ConnectionsGraph } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<ConnectionsGraph | undefined> => {
  const response = await fetch(dataUrl(`/parliament/connections.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
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
