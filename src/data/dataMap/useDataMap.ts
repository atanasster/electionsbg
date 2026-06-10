import { useQuery } from "@tanstack/react-query";

// Types mirror the manifest emitted by scripts/data_map/build_manifest.ts.
// The manifest is bundled with the site (public/data_map.json) — structure,
// layout and labels are code-coupled; live freshness is overlaid at runtime
// from data-changes.json (see useDataMapFreshness in DataMapScreen).

export type DataMapKind = "source" | "dataset" | "feature";

export type DataMapLang = { bg: string; en: string };

export type DataMapSourceRef = {
  id: string;
  label: string;
  url: string;
  cadence?: "hourly" | "daily" | "weekly" | "monthly";
  freshness?: string;
};

export type DataMapNode = {
  id: string;
  kind: DataMapKind;
  label: DataMapLang;
  detail: DataMapLang;
  desc: DataMapLang;
  tags: string[];
  url?: string;
  route?: string;
  origin?: "state" | "eu" | "intl" | "community";
  cadence?: "hourly" | "daily" | "weekly" | "monthly";
  freshness?: string;
  path?: string;
  skills?: string[];
  sources?: DataMapSourceRef[];
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DataMapEdge = { id: string; from: string; to: string };

export type DataMapView = {
  id: string;
  label: DataMapLang;
  tag: string | null;
};

export type DataMapTier = {
  kind: DataMapKind;
  label: DataMapLang;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DataMapManifest = {
  version: number;
  generatedAt: string;
  nodes: DataMapNode[];
  edges: DataMapEdge[];
  views: DataMapView[];
  tiers: DataMapTier[];
};

const fetchDataMap = async (): Promise<DataMapManifest> => {
  const res = await fetch("/data_map.json");
  if (!res.ok) throw new Error(`data_map.json: HTTP ${res.status}`);
  return (await res.json()) as DataMapManifest;
};

export const useDataMap = () =>
  useQuery({ queryKey: ["data-map"], queryFn: fetchDataMap });

/** Upstream ∪ downstream transitive closure of a node (including itself). */
export const dataMapClosure = (
  edges: DataMapEdge[],
  nodeId: string,
): Set<string> => {
  const fwd = new Map<string, string[]>();
  const bwd = new Map<string, string[]>();
  for (const e of edges) {
    fwd.set(e.from, [...(fwd.get(e.from) ?? []), e.to]);
    bwd.set(e.to, [...(bwd.get(e.to) ?? []), e.from]);
  }
  const walk = (start: string, adj: Map<string, string[]>): Set<string> => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };
  return new Set([...walk(nodeId, fwd), ...walk(nodeId, bwd)]);
};
