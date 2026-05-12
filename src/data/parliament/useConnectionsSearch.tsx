import { useQuery } from "@tanstack/react-query";
import type { ConnectionsSearchFile } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<ConnectionsSearchFile | undefined> => {
  const response = await fetch(dataUrl(`/parliament/connections-search.json`));
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useConnectionsSearch = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_connections_search"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  return { searchIndex: data, isLoading };
};
