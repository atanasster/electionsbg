import { useQuery } from "@tanstack/react-query";
import type {
  ConnectionsEdge,
  ConnectionsNode,
  ConnectionsPath,
} from "@/data/dataTypes";
import { useMps } from "./useMps";

export type MpConnectionsSubgraph = {
  mpNodeId: string;
  nodes: ConnectionsNode[];
  edges: ConnectionsEdge[];
  paths: ConnectionsPath[];
};

type MpConnectionsFile = {
  generatedAt: string;
} & MpConnectionsSubgraph;

const fetchSubgraph = async (
  mpId: number,
): Promise<MpConnectionsSubgraph | null> => {
  const response = await fetch(`/parliament/mp-connections/${mpId}.json`);
  if (response.status === 404) return null;
  if (!response.ok) return null;
  const file: MpConnectionsFile = await response.json();
  return {
    mpNodeId: file.mpNodeId,
    nodes: file.nodes,
    edges: file.edges,
    // Older builds didn't emit `paths`; default to empty so the UI can
    // safely fall back to the 1-hop graph.
    paths: file.paths ?? [],
  };
};

/** Fetch the precomputed 1-hop + co-officer 2-hop subgraph for a single MP.
 * Returns null when the MP has no neighbourhood (file does not exist) or
 * before the parliament index has resolved the MP id. */
export const useMpConnections = (
  name?: string | null,
): { subgraph: MpConnectionsSubgraph | null; isLoading: boolean } => {
  const { findMpByName } = useMps();
  const mpId = findMpByName(name)?.id ?? null;

  const q = useQuery({
    queryKey: ["mp_connections", mpId] as const,
    queryFn: () => fetchSubgraph(mpId as number),
    enabled: mpId != null,
    staleTime: Infinity,
  });

  return {
    subgraph: q.data ?? null,
    isLoading: mpId == null ? false : q.isLoading,
  };
};
