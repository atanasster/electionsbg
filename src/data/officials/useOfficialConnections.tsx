import { useQuery } from "@tanstack/react-query";
import type { OfficialConnectionsSubgraph } from "@/data/dataTypes";
import { dataUrl } from "@/data/dataUrl";

const fetchSubgraph = async (
  slug: string,
): Promise<OfficialConnectionsSubgraph | null> => {
  const response = await fetch(
    dataUrl(`/parliament/official-connections/${slug}.json`),
  );
  // An official with no company connections has no subgraph file: the GCS
  // bucket 404s, but the Vite dev server falls through to the SPA's
  // index.html (200, text/html). Treat either as "no subgraph".
  if (!response.ok) return null;
  if (!(response.headers.get("content-type") ?? "").includes("json")) {
    return null;
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
