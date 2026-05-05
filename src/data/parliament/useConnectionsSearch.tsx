import { useQuery } from "@tanstack/react-query";
import type { ConnectionsSearchFile } from "@/data/dataTypes";

const queryFn = async (): Promise<ConnectionsSearchFile | undefined> => {
  const response = await fetch(`/parliament/connections-search.json`);
  if (!response.ok) return undefined;
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
