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

export type DataMapTour = {
  id: string;
  title: DataMapLang;
  steps: { node: string; text: DataMapLang }[];
};

export type DataMapManifest = {
  version: number;
  generatedAt: string;
  nodes: DataMapNode[];
  edges: DataMapEdge[];
  views: DataMapView[];
  tiers: DataMapTier[];
  tours: DataMapTour[];
};

export type DataMapLens = "none" | "cadence" | "origin" | "fresh";

/** Lens value → CSS color expression, applied to source-group nodes. */
export const dataMapLensColor = (
  lens: DataMapLens,
  node: DataMapNode,
  freshAt: string | undefined,
  now: number,
): string | undefined => {
  if (node.kind !== "source") return undefined;
  if (lens === "cadence") {
    switch (node.cadence) {
      case "hourly":
      case "daily":
        return "hsl(var(--chart-1))";
      case "weekly":
        return "hsl(var(--chart-3))";
      case "monthly":
        return "hsl(var(--chart-4))";
      default:
        return "hsl(var(--muted-foreground))";
    }
  }
  if (lens === "origin") {
    switch (node.origin) {
      case "state":
        return "hsl(var(--chart-4))";
      case "eu":
        return "hsl(var(--chart-2))";
      case "intl":
        return "hsl(var(--chart-5))";
      case "community":
        return "hsl(var(--chart-3))";
      default:
        return undefined;
    }
  }
  if (lens === "fresh") {
    if (!freshAt) return "hsl(var(--muted-foreground))";
    const age = now - new Date(freshAt).getTime();
    if (age < 7 * 24 * 3600 * 1000) return "hsl(var(--chart-1))";
    if (age < 30 * 24 * 3600 * 1000) return "hsl(var(--chart-3))";
    return "hsl(var(--chart-5))";
  }
  return undefined;
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
