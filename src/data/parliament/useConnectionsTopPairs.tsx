import { useQuery } from "@tanstack/react-query";
import type { ConnectionsTopPairsFile } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const queryFn = async (): Promise<ConnectionsTopPairsFile | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/connections-top-pairs.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
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
