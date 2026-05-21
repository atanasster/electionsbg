import { useQuery } from "@tanstack/react-query";
import type { OfficialConnectionsSubgraph } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const fetchSubgraph = async (
  slug: string,
): Promise<OfficialConnectionsSubgraph | null> => {
  const response = await fetch(
    dataUrl(`/parliament/official-connections/${slug}.json`),
  );
  // 404 = this official has no company connections (no subgraph file emitted).
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${response.url}`);
  }
  return (await response.json()) as OfficialConnectionsSubgraph;
};

/** Fetch the precomputed 1-hop + 2-hop connections subgraph for one official.
 * Returns null when the official has no neighbourhood (file does not exist). */
export const useOfficialConnections = (
  slug?: string | null,
): { subgraph: OfficialConnectionsSubgraph | null; isLoading: boolean } => {
  const q = useQuery({
    queryKey: ["official_connections", slug] as const,
    queryFn: () => fetchSubgraph(slug as string),
    enabled: !!slug,
    staleTime: Infinity,
  });
  return {
    subgraph: q.data ?? null,
    isLoading: slug ? q.isLoading : false,
  };
};
