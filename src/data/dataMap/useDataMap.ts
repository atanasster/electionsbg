import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Types mirror the manifest emitted by scripts/data_map/build_manifest.ts.
// The manifest is served from the GCS data bucket (data/data_map.json), not
// bundled into the site — so a data refresh re-ships it via `bucket:sync`
// without a full Firebase deploy. Structure, layout and labels are still
// code-coupled; live freshness is overlaid at runtime from data-changes.json
// (see the freshness memo in DataMapScreen).

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

/**
 * A lateral dataset↔dataset relationship. NOT in `edges`: those drive the ELK
 * lineage layout and the closure highlight, and 15 lateral edges in that graph
 * split the dataset tier into five columns. These are rendered separately.
 */
/**
 * Mirrors JoinKey in scripts/data_map/model.ts. Kept a union rather than
 * `string` because step 5 colour-codes links by it: a widened type means a new
 * key silently renders with no colour instead of failing the exhaustive switch.
 */
export type DataMapJoinKey =
  | "eik"
  | "person_id"
  | "ekatte"
  | "procedure"
  | "programme";

export type DataMapLink = {
  id: string;
  /** Both `ds:*`, sorted — the pair is undirected. */
  a: string;
  b: string;
  /** Absent on a boundary link, which has no shared key by construction. */
  key?: DataMapJoinKey;
  kind: "join" | "boundary";
  label: DataMapLang;
  /** Distinct keys present on BOTH sides. */
  overlap?: number;
  /** What the overlap is a share OF, when the key is sparse. */
  of?: DataMapLang;
};

export type DataMapManifest = {
  version: number;
  generatedAt: string;
  nodes: DataMapNode[];
  edges: DataMapEdge[];
  views: DataMapView[];
  tiers: DataMapTier[];
  tours: DataMapTour[];
  links: DataMapLink[];
};

export type DataMapLens = "none" | "cadence" | "origin" | "fresh" | "links";

/** Colour per join key, so the lens legend and the edges cannot disagree. */
export const DATA_MAP_KEY_COLOR: Record<DataMapJoinKey, string> = {
  eik: "hsl(var(--chart-1))",
  person_id: "hsl(var(--chart-2))",
  ekatte: "hsl(var(--chart-3))",
  procedure: "hsl(var(--chart-4))",
  programme: "hsl(var(--chart-5))",
};

/** Lateral neighbours of a node — ONE hop, never a closure. */
export const dataMapLinkNeighbours = (
  links: DataMapLink[],
  nodeId: string,
): DataMapLink[] => links.filter((l) => l.a === nodeId || l.b === nodeId);

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
  const res = await fetch(dataUrl("/data_map.json"));
  if (!res.ok) throw new Error(`data_map.json: HTTP ${res.status}`);
  const m = (await res.json()) as DataMapManifest;
  // The manifest is code-coupled but cached at the CDN (and in the browser),
  // so a returning visitor can get a freshly-hashed JS bundle paired with an
  // older cached data_map.json that predates a field. `tours` is the worked
  // example: it shipped in 3d7b36577c while `version` stayed at 1, so every
  // published manifest carries tours AND says v1 — meaning `version` records
  // when someone remembered to bump it, not what the file contains. Do not
  // branch on it; coerce every array field instead, so no consumer reads
  // `.length`/`.map` of undefined — the page renders with whatever the cached copy carries and
  // self-heals once the cache refreshes.
  return {
    ...m,
    nodes: m.nodes ?? [],
    edges: m.edges ?? [],
    views: m.views ?? [],
    tiers: m.tiers ?? [],
    tours: m.tours ?? [],
    // v2 added `links`. A returning visitor can pair a fresh bundle with a
    // cached v1 manifest, so this must never be read as undefined.
    links: m.links ?? [],
  };
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
