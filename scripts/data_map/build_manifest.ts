// Build the /data/map manifest: validate the curated model against the
// watcher registry, inject freshness from state/watch, run the ELK layered
// layout offline (the ~1.4 MB engine never ships to the client) and write
// the positioned graph to public/data_map.json.
//
//   npm run data:map
//
// Runs as part of `prebuild`, so every deploy refreshes layout + freshness
// and a watcher source missing from the map FAILS the build — that is the
// extensibility contract: new sources must be placed on the map.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api";
import { SOURCES } from "../watch/sources/index";
import type { Cadence } from "../watch/types";
import {
  DATASETS,
  EDGES,
  FEATURES,
  SOURCE_GROUPS,
  TIERS,
  VIEWS,
  type Lang,
  type Origin,
} from "./model";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const STATE_DIR = path.join(ROOT, "state/watch");
const OUT_FILE = path.join(ROOT, "public/data_map.json");

const NODE_W = 240;
const NODE_H = 62;
const TIER_PAD = 28;
const TIER_HEAD = 40;

type Kind = "source" | "dataset" | "feature";

export interface ManifestSourceRef {
  id: string;
  label: string;
  url: string;
  cadence?: Cadence;
  freshness?: string;
}

export interface ManifestNode {
  id: string;
  kind: Kind;
  label: Lang;
  detail: Lang;
  desc: Lang;
  tags: string[];
  url?: string;
  route?: string;
  origin?: Origin;
  cadence?: Cadence;
  freshness?: string;
  path?: string;
  skills?: string[];
  sources?: ManifestSourceRef[];
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ManifestTier {
  kind: Kind;
  label: Lang;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DataMapManifest {
  version: number;
  generatedAt: string;
  nodes: ManifestNode[];
  edges: { id: string; from: string; to: string }[];
  views: { id: string; label: Lang; tag: string | null }[];
  tiers: ManifestTier[];
}

const fail = (msg: string): never => {
  console.error(`\ndata_map: ${msg}\n`);
  process.exit(1);
};

const readFreshness = (sourceId: string): string | undefined => {
  const file = path.join(STATE_DIR, `${sourceId}.json`);
  if (!fs.existsSync(file)) return undefined;
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf-8")) as {
      lastChanged?: string;
    };
    return state.lastChanged;
  } catch {
    return undefined;
  }
};

const CADENCE_RANK: Record<Cadence, number> = {
  hourly: 0,
  daily: 1,
  weekly: 2,
  monthly: 3,
};

const validate = (): void => {
  const registryIds = new Set(SOURCES.map((s) => s.id));
  const placed = new Map<string, string>();
  for (const g of SOURCE_GROUPS) {
    for (const m of g.members) {
      if (!registryIds.has(m))
        fail(
          `group "${g.id}" references unknown watcher source "${m}" — check scripts/watch/sources`,
        );
      if (placed.has(m))
        fail(
          `watcher source "${m}" appears in groups "${placed.get(m)}" and "${g.id}"`,
        );
      placed.set(m, g.id);
    }
  }
  const missing = [...registryIds].filter((id) => !placed.has(id));
  if (missing.length)
    fail(
      `watcher source(s) not placed on the data map: ${missing.join(", ")}.\n` +
        `Add them to a source group in scripts/data_map/model.ts (or create a new group + edges).`,
    );

  const nodeIds = new Set<string>([
    ...SOURCE_GROUPS.map((g) => `src:${g.id}`),
    ...DATASETS.map((d) => `ds:${d.id}`),
    ...FEATURES.map((f) => `f:${f.id}`),
  ]);
  if (nodeIds.size !== SOURCE_GROUPS.length + DATASETS.length + FEATURES.length)
    fail("duplicate node ids in model.ts");

  const connected = new Set<string>();
  for (const [from, to] of EDGES) {
    if (!nodeIds.has(from)) fail(`edge references unknown node "${from}"`);
    if (!nodeIds.has(to)) fail(`edge references unknown node "${to}"`);
    const tierOk =
      (from.startsWith("src:") && to.startsWith("ds:")) ||
      (from.startsWith("ds:") && to.startsWith("f:"));
    if (!tierOk)
      fail(`edge ${from} → ${to} must go source→dataset or dataset→feature`);
    connected.add(from);
    connected.add(to);
  }
  const orphans = [...nodeIds].filter((id) => !connected.has(id));
  if (orphans.length) fail(`node(s) with no edges: ${orphans.join(", ")}`);

  const viewTags = new Set(VIEWS.map((v) => v.tag).filter(Boolean) as string[]);
  for (const n of [...SOURCE_GROUPS, ...DATASETS, ...FEATURES]) {
    for (const t of n.tags)
      if (!viewTags.has(t))
        fail(`node "${n.id}" carries tag "${t}" with no matching view`);
  }
};

const buildNodes = (): ManifestNode[] => {
  const byId = new Map(SOURCES.map((s) => [s.id, s]));
  const nodes: ManifestNode[] = [];

  for (const g of SOURCE_GROUPS) {
    const members = g.members.map((id) => {
      const src = byId.get(id)!;
      return {
        id,
        label: src.label,
        url: src.url,
        cadence: src.cadence,
        freshness: readFreshness(id),
      } satisfies ManifestSourceRef;
    });
    const extras = (g.extras ?? []).map((e) => ({
      id: `static:${e.url}`,
      label:
        e.label.bg === e.label.en
          ? e.label.bg
          : `${e.label.bg} · ${e.label.en}`,
      url: e.url,
    }));
    const freshness = members
      .map((m) => m.freshness)
      .filter(Boolean)
      .sort()
      .pop();
    const cadence = members.length
      ? members
          .map((m) => m.cadence!)
          .sort((a, b) => CADENCE_RANK[a] - CADENCE_RANK[b])[0]
      : undefined;
    nodes.push({
      id: `src:${g.id}`,
      kind: "source",
      label: g.label,
      detail: g.detail,
      desc: g.desc,
      tags: g.tags,
      url: g.url,
      origin: g.origin,
      cadence,
      freshness,
      skills: g.skills,
      sources: [...members, ...extras],
      x: 0,
      y: 0,
      w: NODE_W,
      h: NODE_H,
    });
  }

  for (const d of DATASETS) {
    nodes.push({
      id: `ds:${d.id}`,
      kind: "dataset",
      label: d.label,
      detail: d.detail,
      desc: d.desc,
      tags: d.tags,
      path: d.path,
      x: 0,
      y: 0,
      w: NODE_W,
      h: NODE_H,
    });
  }

  for (const f of FEATURES) {
    nodes.push({
      id: `f:${f.id}`,
      kind: "feature",
      label: f.label,
      detail: f.detail,
      desc: f.desc,
      tags: f.tags,
      route: f.route,
      url: f.href,
      x: 0,
      y: 0,
      w: NODE_W,
      h: NODE_H,
    });
  }

  return nodes;
};

const PARTITION: Record<Kind, number> = { source: 0, dataset: 1, feature: 2 };

const layout = async (nodes: ManifestNode[]): Promise<void> => {
  const elk = new ELK();
  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.partitioning.activate": "true",
      "elk.layered.spacing.nodeNodeBetweenLayers": "110",
      "elk.spacing.nodeNode": "16",
      // React Flow draws its own bezier edges — ELK's per-edge routing
      // channels between layers only waste horizontal space.
      "elk.layered.spacing.edgeEdgeBetweenLayers": "2",
      "elk.layered.spacing.edgeNodeBetweenLayers": "8",
      "elk.spacing.edgeNode": "8",
      "elk.spacing.edgeEdge": "2",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.thoroughness": "30",
    },
    children: nodes.map((n) => ({
      id: n.id,
      width: n.w,
      height: n.h,
      layoutOptions: {
        "elk.partitioning.partition": String(PARTITION[n.kind]),
      },
    })),
    edges: EDGES.map(([from, to], i) => ({
      id: `e${i}`,
      sources: [from],
      targets: [to],
    })),
  };

  const res = await elk.layout(graph);
  const pos = new Map((res.children ?? []).map((c) => [c.id, c]));
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p || p.x === undefined || p.y === undefined)
      fail(`ELK returned no position for ${n.id}`);
    n.x = Math.round(p!.x!);
    n.y = Math.round(p!.y!);
  }

  // Normalise to a small top-left origin.
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  for (const n of nodes) {
    n.x -= minX - TIER_PAD;
    n.y -= minY - (TIER_PAD + TIER_HEAD);
  }
};

const buildTiers = (nodes: ManifestNode[]): ManifestTier[] =>
  TIERS.map((t) => {
    const members = nodes.filter((n) => n.kind === t.kind);
    const x0 = Math.min(...members.map((n) => n.x));
    const y0 = Math.min(...members.map((n) => n.y));
    const x1 = Math.max(...members.map((n) => n.x + n.w));
    const y1 = Math.max(...members.map((n) => n.y + n.h));
    return {
      kind: t.kind,
      label: t.label,
      x: x0 - TIER_PAD,
      y: y0 - TIER_PAD - TIER_HEAD,
      w: x1 - x0 + TIER_PAD * 2,
      h: y1 - y0 + TIER_PAD * 2 + TIER_HEAD,
    };
  });

const main = async (): Promise<void> => {
  validate();
  const nodes = buildNodes();
  await layout(nodes);
  const tiers = buildTiers(nodes);

  const manifest: DataMapManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    nodes,
    edges: EDGES.map(([from, to], i) => ({ id: `e${i}`, from, to })),
    views: VIEWS,
    tiers,
  };

  fs.writeFileSync(OUT_FILE, `${JSON.stringify(manifest, null, 2)}\n`);
  const fresh = nodes.filter((n) => n.freshness).length;
  console.log(
    `data_map: wrote ${path.relative(ROOT, OUT_FILE)} — ${nodes.length} nodes ` +
      `(${SOURCE_GROUPS.length} source groups covering ${SOURCES.length} watched sources), ` +
      `${EDGES.length} edges, freshness on ${fresh} nodes`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
