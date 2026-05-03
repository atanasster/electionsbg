import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ConnectionsEdge,
  ConnectionsGraph,
  ConnectionsNode,
} from "@/data/dataTypes";
import { useMps } from "./useMps";

type ByMpFile = {
  generatedAt: string;
  byMp: Record<string, string[]>;
};

const fetchGraph = async (): Promise<ConnectionsGraph | undefined> => {
  const response = await fetch(`/parliament/connections.json`);
  if (!response.ok) return undefined;
  return response.json();
};

const fetchByMp = async (): Promise<ByMpFile | undefined> => {
  const response = await fetch(`/parliament/connections-by-mp.json`);
  if (!response.ok) return undefined;
  return response.json();
};

export type MpConnectionsSubgraph = {
  mpNodeId: string;
  nodes: ConnectionsNode[];
  edges: ConnectionsEdge[];
};

/** Build a subgraph for the given MP (by display name) using the precomputed
 * 1-hop+co-officer neighbourhood index. Returns null until both data sources
 * have loaded, or when the MP has no neighbourhood entry yet. */
export const useMpConnections = (
  name?: string | null,
): { subgraph: MpConnectionsSubgraph | null; isLoading: boolean } => {
  const { findMpByName } = useMps();
  const mpId = findMpByName(name)?.id;

  const graphQ = useQuery({
    queryKey: ["mp_connections_graph"] as [string],
    queryFn: fetchGraph,
    staleTime: Infinity,
  });
  const byMpQ = useQuery({
    queryKey: ["mp_connections_by_mp"] as [string],
    queryFn: fetchByMp,
    staleTime: Infinity,
  });

  const subgraph = useMemo<MpConnectionsSubgraph | null>(() => {
    if (!graphQ.data || !byMpQ.data || !mpId) return null;
    const ids = byMpQ.data.byMp[String(mpId)];
    if (!ids || ids.length === 0) return null;
    const idSet = new Set(ids);
    const nodes = graphQ.data.nodes.filter((n) => idSet.has(n.id));
    const edges = graphQ.data.edges.filter(
      (e) =>
        idSet.has(e.source as string) && idSet.has(e.target as string),
    );
    return {
      mpNodeId: `mp:${mpId}`,
      nodes,
      edges,
    };
  }, [graphQ.data, byMpQ.data, mpId]);

  return {
    subgraph,
    isLoading: graphQ.isLoading || byMpQ.isLoading,
  };
};
