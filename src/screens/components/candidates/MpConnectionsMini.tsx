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
const HEIGHT = 280;

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
export const MpConnectionsMini: FC<{ name: string }> = ({ name }) => {
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
  const { simNodes, simLinks, neighbors } = useMemo(() => {
    if (!subgraph)
      return {
        simNodes: [] as ConnectionsSimNode[],
        simLinks: [] as ConnectionsSimLink[],
        neighbors: new Map<string, Set<string>>(),
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

    const sn: ConnectionsSimNode[] = filteredNodes.map((n) => ({
      ...n,
      radius:
        n.id === subgraph.mpNodeId
          ? 8
          : n.type === "mp"
            ? 6
            : 3 + Math.min(5, Math.sqrt(degree.get(n.id) ?? 1) * 1.2),
      color: TYPE_COLORS[n.type],
      // Pin the hub MP at origin so the radial layout is stable.
      ...(n.id === subgraph.mpNodeId ? { fx: 0, fy: 0 } : {}),
    }));
    const sl: ConnectionsSimLink[] = filteredEdges.map((e) => ({ ...e }));

    const adj = new Map<string, Set<string>>();
    for (const e of filteredEdges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set());
      if (!adj.has(e.target)) adj.set(e.target, new Set());
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }

    return { simNodes: sn, simLinks: sl, neighbors: adj };
  }, [subgraph, visiblePaths]);

  // Run the d3-force simulation.
  useEffect(() => {
    if (simNodes.length === 0) return;
    const sim = forceSimulation<ConnectionsSimNode, ConnectionsSimLink>(
      simNodes,
    )
      .force(
        "link",
        forceLink<ConnectionsSimNode, ConnectionsSimLink>(simLinks)
          .id((d) => d.id)
          .distance(55)
          .strength(0.6),
      )
      .force("charge", forceManyBody().strength(-80))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.05))
      .force("y", forceY(0).strength(0.05))
      .alpha(1)
      .alphaDecay(0.04);
    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [simNodes, simLinks]);

  if (!subgraph || subgraph.nodes.length <= 1) return null;

  const otherMpCount = subgraph.nodes.filter(
    (n) => n.type === "mp" && n.id !== subgraph.mpNodeId,
  ).length;
  const candidateSlug = encodeURIComponent(name);
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
