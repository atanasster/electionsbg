import { useQuery } from "@tanstack/react-query";
import type { ConnectionsPartyMatrixFile } from "@/data/dataTypes";

const queryFn = async (): Promise<ConnectionsPartyMatrixFile | undefined> => {
  const response = await fetch(`/parliament/connections-party-matrix.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export const useConnectionsPartyMatrix = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_connections_party_matrix"] as [string],
    queryFn,
    staleTime: Infinity,
  });
  return { matrix: data, isLoading };
};
