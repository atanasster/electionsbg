import { useQuery } from "@tanstack/react-query";
import type { ConnectionsRankings, ConnectionsTopMp } from "@/data/dataTypes";
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

// Top-50 slim variant — drops topCompanies and the company side of each NS
// scope. Use this from dashboard tiles that only render the top 5 MPs and
// don't touch companies. The full hook above is still the right choice for
// the /connections explorer and anything that needs the company graph.
export type ConnectionsRankingsTop = {
  generatedAt: string;
  topMps: ConnectionsTopMp[];
  byNs: Record<string, { topMps: ConnectionsTopMp[] }>;
};

const queryFnTop = async (): Promise<ConnectionsRankingsTop | undefined> => {
  const response = await fetch(
    dataUrl(`/parliament/connections-rankings-top.json`),
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return response.json();
};

export const useConnectionsRankingsTop = () => {
  const { data, isLoading } = useQuery({
    queryKey: ["mp_connections_rankings_top"] as [string],
    queryFn: queryFnTop,
    staleTime: Infinity,
  });
  return { rankings: data, isLoading };
};
