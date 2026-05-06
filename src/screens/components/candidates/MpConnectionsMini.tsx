import { FC, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Network, ArrowRight } from "lucide-react";
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from "d3-force";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMpConnections } from "@/data/parliament/useMpConnections";
import type {
  ConnectionsEdge,
  ConnectionsNode,
  ConnectionsPath,
} from "@/data/dataTypes";
import { ConnectionPathRow } from "./ConnectionPathRow";
import {
  ConnectionsCanvas,
  type ConnectionsSimLink,
  type ConnectionsSimNode,
} from "@/screens/components/connections/ConnectionsCanvas";

const TOP_PATHS = 10;
const HEIGHT = 380;

const TYPE_COLORS: Record<ConnectionsNode["type"], string> = {
  mp: "#2563eb",
  company: "#d97706",
  person: "#737373",
};

/** Tile shown on the candidate dashboard. Surfaces the MP's pre-computed
 * shortest paths to *other* MPs via business connections — capped to
 * TOP_PATHS, with a "see details" link to the full per-MP connections
 * page when more exist. A small mini-graph below renders the path-only
 * subgraph (or, when no paths exist, the immediate 1-hop neighborhood
 * as a fallback so the tile stays useful for newly seated MPs).
 *
 * Uses the shared <ConnectionsCanvas> so pan/zoom and the node-detail
 * popover behave the same as on `/connections`. */
export const MpConnectionsMini: FC<{ name: string; linkSlug?: string }> = ({
  name,
  linkSlug,
}) => {
  const { t } = useTranslation();
  const { subgraph } = useMpConnections(name);
  const simRef = useRef<Simulation<
    ConnectionsSimNode,
    ConnectionsSimLink
  > | null>(null);

  // Lookup helpers for the path rows.
  const nodeById = useMemo(() => {
    const m = new Map<string, ConnectionsNode>();
    for (const n of subgraph?.nodes ?? []) m.set(n.id, n);
    return m;
  }, [subgraph]);

  const edgeBetween = useMemo(() => {
    if (!subgraph) return () => undefined;
    const map = new Map<string, ConnectionsEdge>();
    const score = (e: ConnectionsEdge) =>
      (e.isCurrent ? 2 : 0) + (e.confidence === "high" ? 1 : 0);
    for (const e of subgraph.edges) {
      const k =
        e.source < e.target
          ? `${e.source}|${e.target}`
          : `${e.target}|${e.source}`;
      const prior = map.get(k);
      if (!prior || score(e) > score(prior)) map.set(k, e);
    }
    return (a: string, b: string) => {
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      return map.get(k);
    };
  }, [subgraph]);

  // Path subset to render in the rows above the canvas.
  const paths = subgraph?.paths ?? [];
  const visiblePaths: ConnectionsPath[] = paths.slice(0, TOP_PATHS);

  // Build the canvas subgraph: union of all path nodes when paths exist,
  // otherwise fall back to the entire neighborhood (renders the same blob
  // the tile used to show — strictly better than empty for path-less MPs).
  const { simNodes, simLinks, neighbors, isStaticLayout } = useMemo(() => {
    if (!subgraph)
      return {
        simNodes: [] as ConnectionsSimNode[],
        simLinks: [] as ConnectionsSimLink[],
        neighbors: new Map<string, Set<string>>(),
        isStaticLayout: false,
      };

    const includeSet = new Set<string>();
    if (visiblePaths.length > 0) {
      for (const p of visiblePaths)
        for (const id of p.nodeIds) includeSet.add(id);
    } else {
      for (const n of subgraph.nodes) includeSet.add(n.id);
    }

    const filteredEdges = subgraph.edges.filter(
      (e) => includeSet.has(e.source) && includeSet.has(e.target),
    );
    const degree = new Map<string, number>();
    for (const e of filteredEdges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const filteredNodes = subgraph.nodes.filter((n) => includeSet.has(n.id));

    // 1-hop neighborhood fallback: place satellites in a deterministic ring
    // around the hub. d3-force on such a small graph collapses the satellite
    // onto the avatar, so we pin everything ourselves and skip the sim.
    // Cap radii by half the canvas height (minus avatar radius and label
    // padding) so MP nodes don't get clipped at the top/bottom of the panel.
    const maxOrbitR = Math.max(80, HEIGHT / 2 - 40);
    const useNeighborhoodFallback = visiblePaths.length === 0;
    const satellites = filteredNodes.filter((n) => n.id !== subgraph.mpNodeId);
    const orbitR = Math.max(
      90,
      Math.min(maxOrbitR, 110 + satellites.length * 18),
    );
    const satIndex = new Map<string, number>();
    satellites.forEach((n, i) => satIndex.set(n.id, i));

    // Path-subgraph mode: lay out the full chain statically. Pin each target
    // MP at a deterministic angle around the hub, then place each intermediate
    // (company/person) at its fractional position along the line from hub to
    // target. Without this, d3-force charge repulsion fights the link force
    // and intermediates can settle on the opposite side of the hub from their
    // target MP — the bug this layout exists to prevent.
    const pinnedPositions = new Map<string, { x: number; y: number }>();
    if (!useNeighborhoodFallback) {
      const targetMpIds: string[] = [];
      const seenTargets = new Set<string>();
      for (const p of visiblePaths) {
        if (p.targetMpNodeId && !seenTargets.has(p.targetMpNodeId)) {
          seenTargets.add(p.targetMpNodeId);
          targetMpIds.push(p.targetMpNodeId);
        }
      }
      const targetCount = targetMpIds.length || 1;
      const targetR = Math.max(
        110,
        Math.min(maxOrbitR, 110 + targetCount * 12),
      );
      const targetAngle = new Map<string, number>();
      targetMpIds.forEach((id, i) => {
        const angle = (i / targetCount) * Math.PI * 2 - Math.PI / 2;
        targetAngle.set(id, angle);
        pinnedPositions.set(id, {
          x: Math.cos(angle) * targetR,
          y: Math.sin(angle) * targetR,
        });
      });
      pinnedPositions.set(subgraph.mpNodeId, { x: 0, y: 0 });

      // For intermediate nodes: average their position across every path they
      // appear on (a node can be on multiple paths to different targets).
      const sums = new Map<string, { x: number; y: number; n: number }>();
      for (const p of visiblePaths) {
        const angle = targetAngle.get(p.targetMpNodeId);
        if (angle === undefined) continue;
        const len = p.nodeIds.length;
        if (len < 3) continue;
        for (let i = 1; i < len - 1; i++) {
          const id = p.nodeIds[i];
          if (pinnedPositions.has(id)) continue;
          const t = i / (len - 1);
          const r = t * targetR;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          const prior = sums.get(id) ?? { x: 0, y: 0, n: 0 };
          prior.x += x;
          prior.y += y;
          prior.n += 1;
          sums.set(id, prior);
        }
      }
      for (const [id, s] of sums)
        pinnedPositions.set(id, { x: s.x / s.n, y: s.y / s.n });
    }

    const sn: ConnectionsSimNode[] = filteredNodes.map((n) => {
      const isHub = n.id === subgraph.mpNodeId;
      const node: ConnectionsSimNode = {
        ...n,
        radius: isHub
          ? 22
          : n.type === "mp"
            ? 16
            : 4 + Math.min(6, Math.sqrt(degree.get(n.id) ?? 1) * 1.4),
        color: TYPE_COLORS[n.type],
      };
      if (isHub) {
        node.fx = 0;
        node.fy = 0;
        node.x = 0;
        node.y = 0;
      } else if (useNeighborhoodFallback) {
        const idx = satIndex.get(n.id) ?? 0;
        const total = satellites.length || 1;
        const angle = (idx / total) * Math.PI * 2 - Math.PI / 2;
        node.fx = Math.cos(angle) * orbitR;
        node.fy = Math.sin(angle) * orbitR;
        node.x = node.fx;
        node.y = node.fy;
      } else {
        const pos = pinnedPositions.get(n.id);
        if (pos) {
          node.fx = pos.x;
          node.fy = pos.y;
          node.x = pos.x;
          node.y = pos.y;
        }
      }
      return node;
    });
    // Resolve link source/target to node objects up-front. d3-force's
    // forceLink normally does this, but every node here is pinned so we skip
    // the sim entirely — without manual resolution the canvas wouldn't have
    // x/y to draw the edges. We mirror d3-force's mutation by replacing the
    // string ids with node refs after construction (the link type narrows
    // source/target to `string`, but the canvas already casts to a node).
    const nodeById = new Map<string, ConnectionsSimNode>();
    for (const n of sn) nodeById.set(n.id, n);
    const sl: ConnectionsSimLink[] = filteredEdges.map((e) => ({ ...e }));
    for (const link of sl) {
      const src = nodeById.get(link.source as unknown as string);
      const tgt = nodeById.get(link.target as unknown as string);
      if (src) link.source = src as unknown as string;
      if (tgt) link.target = tgt as unknown as string;
    }

    const adj = new Map<string, Set<string>>();
    for (const e of filteredEdges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }

    // Both branches now produce a fully-pinned layout, so the d3-force
    // simulation is unnecessary. The flag is kept in case a future tweak
    // re-introduces unpinned nodes.
    return {
      simNodes: sn,
      simLinks: sl,
      neighbors: adj,
      isStaticLayout: true,
    };
  }, [subgraph, visiblePaths]);

  // Run the d3-force simulation. Skipped when every node is already pinned
  // by the static radial fallback above.
  useEffect(() => {
    if (simNodes.length === 0 || isStaticLayout) return;
    const sim = forceSimulation<ConnectionsSimNode, ConnectionsSimLink>(
      simNodes,
    )
      .force(
        "link",
        forceLink<ConnectionsSimNode, ConnectionsSimLink>(simLinks)
          .id((d) => d.id)
          .distance(140)
          .strength(0.5),
      )
      .force("charge", forceManyBody().strength(-360))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.015))
      .force("y", forceY(0).strength(0.04))
      .alpha(1)
      .alphaDecay(0.04);
    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [simNodes, simLinks, isStaticLayout]);

  if (!subgraph || subgraph.nodes.length <= 1) return null;

  const otherMpCount = subgraph.nodes.filter(
    (n) => n.type === "mp" && n.id !== subgraph.mpNodeId,
  ).length;
  const candidateSlug = linkSlug ?? encodeURIComponent(name);
  const showMore = paths.length > TOP_PATHS;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Network className="h-4 w-4" />
          {t("mp_connections_mini_title") || "Connections to other MPs"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {paths.length === 0
              ? t("mp_connections_no_paths") ||
                "No paths to other MPs in the data"
              : `${paths.length} ${t("mp_connections_paths_count") || "path(s)"} · ${otherMpCount} ${(
                  t("connections_other_mps") || "other MP(s)"
                ).toLowerCase()}`}
          </span>
          {showMore ? (
            <Link
              to={`/candidate/${candidateSlug}/connections`}
              className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
            >
              {t("dashboard_see_details") || "See details"}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ) : (
            <Link
              to="/connections"
              className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
            >
              {t("mp_connections_open_full") || "Open full graph"}
              <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {visiblePaths.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {visiblePaths.map((p, i) => (
              <ConnectionPathRow
                key={`${p.targetMpNodeId}-${i}`}
                path={p}
                nodeById={nodeById}
                edgeBetween={edgeBetween}
              />
            ))}
          </div>
        ) : null}

        <ConnectionsCanvas
          simNodes={simNodes}
          simLinks={simLinks}
          neighbors={neighbors}
          pinNodeId={subgraph.mpNodeId}
          height={HEIGHT}
        />
        <div className="text-xs text-muted-foreground">
          {visiblePaths.length === 0
            ? t("mp_connections_neighborhood_hint") ||
              "Showing immediate 1-hop business neighborhood (no MP→MP paths found)."
            : t("mp_connections_path_graph_hint") ||
              "Path subgraph — click a node for details. Ctrl/Cmd + scroll to zoom, drag to pan."}
        </div>
      </CardContent>
    </Card>
  );
};
