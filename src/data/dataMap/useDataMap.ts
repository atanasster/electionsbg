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

/** Mirrors Origin in scripts/data_map/model.ts (build-time only — this is
 *  the one client-safe copy; see entryGraph.test.ts's registry rule). */
export type DataMapOrigin = "state" | "eu" | "intl" | "community";

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
  origin?: DataMapOrigin;
  cadence?: "hourly" | "daily" | "weekly" | "monthly";
  freshness?: string;
  path?: string;
  skills?: string[];
  sources?: DataMapSourceRef[];
  /** A known operational caveat about a source node — see model.ts's SourceIssue. */
  issue?: { label: DataMapLang; note: DataMapLang };
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
  /** A /db library query id that walks this link, resolved at build time. */
  query?: string;
};

/** One baked ELK layout — see dataMapView below and the v1 plan. */
export type DataMapLayout = {
  nodes: { id: string; x: number; y: number }[];
  tiers: DataMapTier[];
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
  /** v3. Absent on a cached v2 manifest — dataMapView falls back. */
  layouts?: Record<string, DataMapLayout>;
};

/** What the map draws for one view. */
export type DataMapViewGraph = {
  nodes: DataMapNode[];
  tiers: DataMapTier[];
  edges: DataMapEdge[];
  links: DataMapLink[];
  /**
   * Per drawn node, how many of its lineage edges the view does NOT show.
   *
   * A view's membership is a curated `tags` array and does not follow lineage,
   * so filtering edges to the members can leave a card with every arrow in one
   * direction gone — `ds:demographics` draws with no source in `elections`,
   * `src:eurostat` feeds nothing in `prices`. On a page whose whole subject is
   * provenance, a card with no arrows reads as an answer rather than as an
   * omission, so the card says how many are hidden instead.
   *
   * Closing each view over one lineage hop was the obvious alternative and is
   * measurably worse: it takes `elections` from 20 nodes to 48 and `prices`
   * from 9 to 34, which gives back most of the collapse the layouts exist for.
   */
  hidden: Map<string, number>;
  /**
   * True only on the fallback path. With a baked layout the view's non-members
   * are ABSENT, so there is nothing to dim; without one the whole graph is
   * drawn and the others are dimmed, which is how this filter behaved before
   * v3 and is what a cached v2 manifest still gets.
   */
  dimNonMembers: boolean;
};

/**
 * Resolve the graph for one view — the ONE place that decides what the map
 * draws, so the canvas, the panel and the framing cannot disagree about which
 * nodes exist.
 *
 * The `?view=` filter used to dim: the graph stayed 108 nodes at full size
 * whichever view was picked, so a reader who asked for „Избори" still scrolled
 * 3,584px past 88 greyed-out cards. With the baked layouts it reflows —
 * measured, elections goes 986x3584 to 952x624 at the same 1.15x zoom.
 */
export const dataMapView = (
  manifest: DataMapManifest,
  viewId: string,
): DataMapViewGraph => {
  // The manifest's own view list is the vocabulary, and the lookup is
  // own-property-only. `?view=` comes straight off the query string, and
  // `manifest` comes from JSON.parse — so `layouts["constructor"]`,
  // `["__proto__"]`, `["toString"]` and friends are all TRUTHY, the `!layout`
  // fallback is skipped, and `layout.nodes.map` throws. That throw happens in a
  // useMemo during render with no ErrorBoundary anywhere in src/, i.e.
  // `/data?view=constructor` is a blank page rather than a degraded one.
  // `?lens=` two lines away in the screen was already validated this way.
  const known = manifest.views.some((v) => v.id === viewId);
  const layout =
    known &&
    Object.prototype.hasOwnProperty.call(manifest.layouts ?? {}, viewId)
      ? manifest.layouts![viewId]
      : undefined;
  // An id the manifest does not know is not a narrower view — it is no view at
  // all, so it must not dim the map down to nothing either.
  if (!layout || !layout.nodes.length)
    return {
      nodes: manifest.nodes,
      tiers: manifest.tiers,
      edges: manifest.edges,
      links: manifest.links,
      hidden: new Map(),
      dimNonMembers: known && viewId !== "all",
    };
  const at = new Map(layout.nodes.map((n) => [n.id, n]));
  const nodes = manifest.nodes
    .filter((n) => at.has(n.id))
    .map((n) => ({ ...n, x: at.get(n.id)!.x, y: at.get(n.id)!.y }));
  const ids = new Set(nodes.map((n) => n.id));
  // Both are filtered to the members: an edge with one end outside the view has
  // nowhere to land, and React Flow drops such an edge silently rather than
  // erroring — the failure class lateralHandles.test.ts exists for.
  const hidden = new Map<string, number>();
  for (const e of manifest.edges) {
    const from = ids.has(e.from);
    const to = ids.has(e.to);
    if (from === to) continue;
    const inside = from ? e.from : e.to;
    hidden.set(inside, (hidden.get(inside) ?? 0) + 1);
  }
  return {
    nodes,
    tiers: layout.tiers,
    edges: manifest.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
    links: manifest.links.filter((l) => ids.has(l.a) && ids.has(l.b)),
    hidden,
    dimNonMembers: false,
  };
};

export type DataMapLens = "none" | "cadence" | "origin" | "fresh" | "links";

/**
 * How recent a source's last change must be to render as "fresh" — the pulsing
 * dot on the map. One definition: the canvas derives its window from it and the
 * head's hint interpolates it, so the number a reader is told and the number
 * that decides the dot cannot drift apart.
 */
export const DATA_MAP_FRESH_DAYS = 7;

/** The second boundary the "fresh" lens and freshness badges bucket on. */
export const DATA_MAP_AGING_DAYS = 30;

/**
 * "static" means no freshness signal exists at all (no watcher, no
 * update-* skill) — a manually maintained anchor — never "very old".
 * Conflating the two would render a source nobody ever expects to see move
 * the same way as one that has genuinely gone stale.
 */
export type DataMapFreshnessTier = "fresh" | "aging" | "stale" | "static";

/** One definition of the fresh/aging/stale/static bucket, shared by every
 *  lens, legend and badge that classifies a node's freshness timestamp. */
export const dataMapFreshnessTier = (
  freshAt: string | undefined,
  now: number,
): DataMapFreshnessTier => {
  if (!freshAt) return "static";
  const age = now - new Date(freshAt).getTime();
  if (age < DATA_MAP_FRESH_DAYS * 24 * 3600 * 1000) return "fresh";
  if (age < DATA_MAP_AGING_DAYS * 24 * 3600 * 1000) return "aging";
  return "stale";
};

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
    const tier = dataMapFreshnessTier(freshAt, now);
    switch (tier) {
      case "fresh":
        return "hsl(var(--chart-1))";
      case "aging":
        return "hsl(var(--chart-3))";
      case "stale":
        return "hsl(var(--chart-5))";
      case "static":
        return "hsl(var(--muted-foreground))";
      default: {
        const _exhaustive: never = tier;
        return _exhaustive;
      }
    }
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
  // `.length`/`.map` of undefined — the page renders with whatever the cached
  // copy carries and self-heals once the cache refreshes.
  //
  // `layouts` (v3) is the one field NOT coerced: it is a Record rather than an
  // array, and its single reader — dataMapView — already guards it with `?.`
  // and an own-property check before touching it.
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

/**
 * Live freshness overlay: data-changes.json (refreshed with every ingest,
 * served from the data bucket) can be newer than the build-time stamp baked
 * into the manifest — take the max per node via its update skills. Shared by
 * every screen that needs a node's freshest known timestamp, so the map and
 * the sources registry read the exact same date for the same node.
 */
export const computeFreshnessMap = (
  nodes: DataMapNode[],
  changeEntries: { skill: string; date: string }[] | undefined,
): Map<string, string> => {
  const map = new Map<string, string>();
  if (!changeEntries || !nodes.length) return map;
  const latestBySkill = new Map<string, string>();
  for (const e of changeEntries) {
    const prev = latestBySkill.get(e.skill);
    if (!prev || e.date > prev) latestBySkill.set(e.skill, e.date);
  }
  for (const n of nodes) {
    let best = n.freshness ?? "";
    for (const skill of n.skills ?? []) {
      const d = latestBySkill.get(skill);
      if (d && d > best.slice(0, 10)) best = d;
    }
    if (best) map.set(n.id, best);
  }
  return map;
};

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
