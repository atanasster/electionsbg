import { FC, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { Title } from "@/ux/Title";
import { Card, CardContent } from "@/ux/Card";
import { useConnectionsGraph } from "@/data/parliament/useConnectionsGraph";
import { useConnectionsRankings } from "@/data/parliament/useConnectionsRankings";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import type {
  ConnectionsEdge,
  ConnectionsGraph,
  ConnectionsNode,
} from "@/data/dataTypes";

// d3-force mutates nodes in place — extend our typed node with the simulation
// fields it adds. We carry the original node fields too so the renderer can
// branch on `.type`.
type SimNode = ConnectionsNode &
  SimulationNodeDatum & {
    radius: number;
    color: string;
  };
type SimLink = SimulationLinkDatum<SimNode> & ConnectionsEdge;

const TYPE_COLORS: Record<ConnectionsNode["type"], string> = {
  mp: "#2563eb", // blue
  company: "#d97706", // amber/gold
  person: "#737373", // gray
};

const radiusForDegree = (degree: number): number =>
  3 + Math.min(7, Math.sqrt(degree) * 1.5);

type Filters = {
  showCurrentOnly: boolean;
  hideTransferred: boolean;
  highConfidenceOnly: boolean;
  largestComponentOnly: boolean;
};

/** Group connected nodes into their connected-component id (returned as the
 * smallest node id in each component). */
const computeComponents = (
  nodes: SimNode[],
  links: SimLink[],
): Map<string, string> => {
  const adj = new Map<string, Set<string>>();
  for (const e of links) {
    const s = e.source as string;
    const t = e.target as string;
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s)!.add(t);
    adj.get(t)!.add(s);
  }
  const componentOf = new Map<string, string>();
  for (const n of nodes) {
    if (componentOf.has(n.id)) continue;
    const cid = n.id;
    componentOf.set(n.id, cid);
    const queue: string[] = [n.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (componentOf.has(next)) continue;
        componentOf.set(next, cid);
        queue.push(next);
      }
    }
  }
  return componentOf;
};

const buildSimNodes = (
  graph: ConnectionsGraph,
  filters: Filters,
): { simNodes: SimNode[]; simLinks: SimLink[]; degree: Map<string, number> } => {
  // Filter edges first so we can drop orphan nodes.
  const filteredEdges = graph.edges.filter((e) => {
    if (filters.showCurrentOnly && !e.isCurrent) return false;
    if (filters.hideTransferred && e.role === "transferred_share") return false;
    if (filters.highConfidenceOnly && e.confidence !== "high") return false;
    return true;
  });

  const degree = new Map<string, number>();
  for (const e of filteredEdges) {
    degree.set(e.source as string, (degree.get(e.source as string) ?? 0) + 1);
    degree.set(e.target as string, (degree.get(e.target as string) ?? 0) + 1);
  }

  let simNodes: SimNode[] = [];
  for (const n of graph.nodes) {
    const d = degree.get(n.id) ?? 0;
    if (d === 0) continue; // drop orphans after filtering
    simNodes.push({
      ...n,
      radius: radiusForDegree(d),
      color: TYPE_COLORS[n.type],
    });
  }

  let simLinks: SimLink[] = filteredEdges.map((e) => ({ ...e }));

  if (filters.largestComponentOnly && simNodes.length > 0) {
    const comp = computeComponents(simNodes, simLinks);
    const sizeByComp = new Map<string, number>();
    for (const cid of comp.values())
      sizeByComp.set(cid, (sizeByComp.get(cid) ?? 0) + 1);
    let bestCid: string | null = null;
    let bestSize = -1;
    for (const [cid, size] of sizeByComp.entries()) {
      if (size > bestSize) {
        bestSize = size;
        bestCid = cid;
      }
    }
    if (bestCid != null) {
      simNodes = simNodes.filter((n) => comp.get(n.id) === bestCid);
      simLinks = simLinks.filter(
        (e) =>
          comp.get(e.source as string) === bestCid &&
          comp.get(e.target as string) === bestCid,
      );
    }
  }

  return { simNodes, simLinks, degree };
};

export const ConnectionsScreen: FC = () => {
  const { t } = useTranslation();
  const { graph, isLoading } = useConnectionsGraph();
  const { rankings } = useConnectionsRankings();
  const [showRankings, setShowRankings] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);

  // Camera (pan/zoom) maintained in plain refs so we re-render the canvas on
  // every simulation tick without restarting React. Drag-to-pan is supported
  // via mouse events on the canvas.
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 });
  const draggingRef = useRef<{ kind: "pan" | "node"; nodeId?: string } | null>(
    null,
  );
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredIdRef = useRef<string | null>(null);

  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hovered, setHovered] = useState<SimNode | null>(null);
  const [selected, setSelected] = useState<SimNode | null>(null);
  const [filters, setFilters] = useState<Filters>({
    showCurrentOnly: false,
    hideTransferred: false,
    highConfidenceOnly: false,
    largestComponentOnly: false,
  });
  const [clusterByParty, setClusterByParty] = useState(false);

  // Search-by-name autocomplete
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Path-finding: when two MPs are picked, BFS the unfiltered graph to find
  // the shortest path between them, then highlight it.
  const [pathPickMode, setPathPickMode] = useState(false);
  const [pathFrom, setPathFrom] = useState<SimNode | null>(null);
  const [pathTo, setPathTo] = useState<SimNode | null>(null);
  const [pathNodeIds, setPathNodeIds] = useState<Set<string> | null>(null);
  const [pathEdgeKeys, setPathEdgeKeys] = useState<Set<string> | null>(null);

  // Resize observer keeps the canvas full-width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setSize({
        w: Math.max(320, Math.floor(rect.width)),
        h: Math.max(420, Math.floor(window.innerHeight - rect.top - 24)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Rebuild simulation when graph or filters change.
  const { simNodes, simLinks, neighbors } = useMemo(() => {
    if (!graph)
      return {
        simNodes: [] as SimNode[],
        simLinks: [] as SimLink[],
        neighbors: new Map<string, Set<string>>(),
      };
    const { simNodes, simLinks } = buildSimNodes(graph, filters);
    const neighbors = new Map<string, Set<string>>();
    for (const e of simLinks) {
      const s = e.source as string;
      const t = e.target as string;
      if (!neighbors.has(s)) neighbors.set(s, new Set());
      if (!neighbors.has(t)) neighbors.set(t, new Set());
      neighbors.get(s)!.add(t);
      neighbors.get(t)!.add(s);
    }
    return { simNodes, simLinks, neighbors };
  }, [graph, filters]);

  // Map party group → angular target (radians) for clustering. Computed once
  // per simulation rebuild so partyAngle stays stable across ticks.
  const partyAngleByGroup = useMemo(() => {
    const groups = new Set<string>();
    for (const n of simNodes) {
      if (n.type === "mp" && n.partyGroupShort) groups.add(n.partyGroupShort);
    }
    const sorted = Array.from(groups).sort();
    const map = new Map<string, number>();
    sorted.forEach((g, i) => {
      map.set(g, (i / sorted.length) * Math.PI * 2);
    });
    return map;
  }, [simNodes]);

  useEffect(() => {
    if (simNodes.length === 0) return;
    const radius = 240; // cluster radius from origin

    const targetX = (n: SimNode): number => {
      if (!clusterByParty) return 0;
      if (n.type !== "mp" || !n.partyGroupShort) return 0;
      const a = partyAngleByGroup.get(n.partyGroupShort);
      return a == null ? 0 : Math.cos(a) * radius;
    };
    const targetY = (n: SimNode): number => {
      if (!clusterByParty) return 0;
      if (n.type !== "mp" || !n.partyGroupShort) return 0;
      const a = partyAngleByGroup.get(n.partyGroupShort);
      return a == null ? 0 : Math.sin(a) * radius;
    };

    const sim = forceSimulation<SimNode, SimLink>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => (d.kind === "declared_stake" ? 60 : 80))
          .strength(0.4),
      )
      .force("charge", forceManyBody().strength(-80))
      .force("center", forceCenter(0, 0))
      .force(
        "x",
        forceX<SimNode>().x(targetX).strength(clusterByParty ? 0.15 : 0.04),
      )
      .force(
        "y",
        forceY<SimNode>().y(targetY).strength(clusterByParty ? 0.15 : 0.04),
      )
      .alpha(1)
      .alphaDecay(0.02);

    simRef.current = sim;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [simNodes, simLinks, clusterByParty, partyAngleByGroup]);

  // Render loop driven by RAF — reads simulation state, draws to canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      const { w, h } = size;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const cam = cameraRef.current;
      ctx.save();
      ctx.translate(w / 2 + cam.x, h / 2 + cam.y);
      ctx.scale(cam.scale, cam.scale);

      const hoveredId = hoveredIdRef.current;
      // Highlight set: the path takes precedence over hover.
      const highlightSet =
        pathNodeIds ??
        (hoveredId
          ? new Set([hoveredId, ...(neighbors.get(hoveredId) ?? [])])
          : null);

      // Edges
      ctx.lineWidth = 0.5 / cam.scale;
      for (const link of simLinks) {
        const s = link.source as SimNode;
        const tn = link.target as SimNode;
        if (s.x == null || tn.x == null) continue;
        const onPath =
          pathEdgeKeys && pathEdgeKeys.has(`${s.id}|${tn.id}`);
        const dimmed =
          highlightSet &&
          !onPath &&
          !(highlightSet.has(s.id) && highlightSet.has(tn.id));
        if (onPath) {
          ctx.strokeStyle = "#dc2626"; // red path
          ctx.lineWidth = 2 / cam.scale;
        } else {
          ctx.strokeStyle = dimmed
            ? "rgba(120,120,120,0.08)"
            : link.kind === "declared_stake"
              ? "rgba(37,99,235,0.45)"
              : "rgba(217,119,6,0.45)";
          ctx.lineWidth = 0.5 / cam.scale;
        }
        if (link.isCurrent) {
          ctx.setLineDash([]);
        } else {
          ctx.setLineDash([3, 3]);
        }
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(tn.x!, tn.y!);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineWidth = 0.5 / cam.scale;

      // Nodes
      for (const n of simNodes) {
        if (n.x == null || n.y == null) continue;
        const onPath = pathNodeIds?.has(n.id);
        const dimmed = highlightSet && !onPath && !highlightSet.has(n.id);
        ctx.beginPath();
        ctx.arc(n.x, n.y, onPath ? n.radius + 1.5 : n.radius, 0, Math.PI * 2);
        ctx.fillStyle = dimmed
          ? "rgba(170,170,170,0.4)"
          : onPath
            ? "#dc2626"
            : n.color;
        ctx.fill();
        const isEndpoint =
          n.id === pathFrom?.id || n.id === pathTo?.id;
        if (selected?.id === n.id || isEndpoint) {
          ctx.strokeStyle = isEndpoint ? "#dc2626" : "#000";
          ctx.lineWidth = 2 / cam.scale;
          ctx.stroke();
          ctx.lineWidth = 0.5 / cam.scale;
        }
      }

      // Labels for high-degree or hovered/selected nodes
      ctx.fillStyle = "#222";
      ctx.font = `${11 / cam.scale}px system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      for (const n of simNodes) {
        if (n.x == null || n.y == null) continue;
        const isImportant =
          n.id === hoveredId ||
          n.id === selected?.id ||
          n.radius > 6 / cam.scale + 2;
        if (!isImportant) continue;
        ctx.fillText(n.label, n.x + n.radius + 2, n.y);
      }

      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, simNodes, simLinks, neighbors, selected]);

  // ---- Search ------------------------------------------------------------
  const normalizeForSearch = (s: string): string =>
    s.toLowerCase().replace(/\s+/g, " ").trim();

  const searchSuggestions = useMemo<SimNode[]>(() => {
    const q = normalizeForSearch(searchQuery);
    if (q.length < 2) return [];
    const matches: Array<{ n: SimNode; score: number }> = [];
    for (const n of simNodes) {
      const label = normalizeForSearch(n.label);
      if (!label.includes(q)) continue;
      // Score: exact prefix beats substring; shorter labels win ties.
      const score =
        (label.startsWith(q) ? 1000 : 0) + (1000 - label.length);
      matches.push({ n, score });
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 8).map((m) => m.n);
  }, [searchQuery, simNodes]);

  const focusNode = (n: SimNode) => {
    setSelected(n);
    if (n.x != null && n.y != null) {
      // Center camera on the node (subtract because translate(cam.x, cam.y)
      // shifts the world by cam.x; to put node at center of screen with
      // scale s, we need cam.x = -node.x * s).
      const s = cameraRef.current.scale;
      cameraRef.current.x = -n.x * s;
      cameraRef.current.y = -n.y * s;
    }
    setSearchQuery("");
    setShowSearchSuggestions(false);
    searchInputRef.current?.blur();
  };

  // ---- Mouse interactions: hover, click, pan, drag node, zoom ----
  const screenToWorld = (sx: number, sy: number) => {
    const cam = cameraRef.current;
    return {
      x: (sx - size.w / 2 - cam.x) / cam.scale,
      y: (sy - size.h / 2 - cam.y) / cam.scale,
    };
  };

  const findNodeAt = (sx: number, sy: number): SimNode | null => {
    const { x, y } = screenToWorld(sx, sy);
    for (let i = simNodes.length - 1; i >= 0; i--) {
      const n = simNodes[i];
      if (n.x == null || n.y == null) continue;
      const dx = n.x - x;
      const dy = n.y - y;
      const r = n.radius + 2;
      if (dx * dx + dy * dy <= r * r) return n;
    }
    return null;
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const drag = draggingRef.current;
    const last = lastMouseRef.current;
    if (drag && last) {
      const dx = sx - last.x;
      const dy = sy - last.y;
      if (drag.kind === "pan") {
        cameraRef.current.x += dx;
        cameraRef.current.y += dy;
      } else if (drag.kind === "node" && drag.nodeId) {
        const n = simNodes.find((nn) => nn.id === drag.nodeId);
        if (n && n.x != null && n.y != null) {
          n.fx = (n.x ?? 0) + dx / cameraRef.current.scale;
          n.fy = (n.y ?? 0) + dy / cameraRef.current.scale;
        }
        simRef.current?.alphaTarget(0.3).restart();
      }
      lastMouseRef.current = { x: sx, y: sy };
      return;
    }
    const node = findNodeAt(sx, sy);
    hoveredIdRef.current = node?.id ?? null;
    setHovered(node);
    e.currentTarget.style.cursor = node ? "pointer" : "default";
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const node = findNodeAt(sx, sy);
    lastMouseRef.current = { x: sx, y: sy };
    if (node) {
      draggingRef.current = { kind: "node", nodeId: node.id };
    } else {
      draggingRef.current = { kind: "pan" };
    }
  };

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = draggingRef.current;
    const last = lastMouseRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (drag?.kind === "node" && drag.nodeId) {
      // Release pin so the node settles back into the simulation.
      const n = simNodes.find((nn) => nn.id === drag.nodeId);
      if (n) {
        n.fx = null;
        n.fy = null;
      }
      simRef.current?.alphaTarget(0);
    }
    // Detect click (no drag distance)
    if (last && Math.abs(sx - last.x) < 3 && Math.abs(sy - last.y) < 3) {
      const node = findNodeAt(sx, sy);
      if (pathPickMode && node && node.type === "mp") {
        if (!pathFrom) {
          setPathFrom(node);
        } else if (!pathTo && node.id !== pathFrom.id) {
          setPathTo(node);
          setPathPickMode(false);
        } else if (node.id === pathFrom.id) {
          setPathFrom(null);
        }
      } else {
        setSelected(node);
      }
    }
    draggingRef.current = null;
    lastMouseRef.current = null;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const cam = cameraRef.current;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    cam.scale = Math.max(0.2, Math.min(5, cam.scale * factor));
  };

  // ---- Path-finding (BFS on the filtered neighbors map) ----------------
  useEffect(() => {
    if (!pathFrom || !pathTo) {
      setPathNodeIds(null);
      setPathEdgeKeys(null);
      return;
    }
    // BFS
    const prev = new Map<string, string | null>();
    prev.set(pathFrom.id, null);
    const queue: string[] = [pathFrom.id];
    let found = false;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === pathTo.id) {
        found = true;
        break;
      }
      for (const next of neighbors.get(cur) ?? []) {
        if (prev.has(next)) continue;
        prev.set(next, cur);
        queue.push(next);
      }
    }
    if (!found) {
      setPathNodeIds(new Set([pathFrom.id, pathTo.id]));
      setPathEdgeKeys(new Set());
      return;
    }
    const trail: string[] = [];
    for (let cur: string | null = pathTo.id; cur != null; cur = prev.get(cur) ?? null) {
      trail.push(cur);
    }
    trail.reverse();
    const nodeSet = new Set(trail);
    const edgeSet = new Set<string>();
    for (let i = 0; i < trail.length - 1; i++) {
      // Each undirected pair could be (a,b) or (b,a) in the source link list.
      const a = trail[i];
      const b = trail[i + 1];
      edgeSet.add(`${a}|${b}`);
      edgeSet.add(`${b}|${a}`);
    }
    setPathNodeIds(nodeSet);
    setPathEdgeKeys(edgeSet);
  }, [pathFrom, pathTo, neighbors]);

  // ---- Detail panel content ----
  const detail = selected ?? hovered;
  const detailNeighbors = detail
    ? Array.from(neighbors.get(detail.id) ?? [])
        .map((id) => simNodes.find((n) => n.id === id))
        .filter((n): n is SimNode => !!n)
    : [];

  const stats = useMemo(() => {
    const counts = { mp: 0, company: 0, person: 0 };
    for (const n of simNodes) counts[n.type]++;
    return { ...counts, edges: simLinks.length };
  }, [simNodes, simLinks]);

  return (
    <div className="w-full px-4 md:px-8" ref={containerRef}>
      <Title description="MP–company–person connections graph">
        {t("connections_title") || "Connections"}
      </Title>

      {rankings && rankings.topMps.length > 0 && (
        <Card className="my-4">
          <CardContent className="p-3 md:p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">
                {t("connections_rankings_title") || "Most-connected"}
                <span className="font-normal text-muted-foreground ml-2 text-xs">
                  {t("connections_rankings_subtitle") ||
                    "by high-confidence ties"}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setShowRankings((v) => !v)}
                className="text-xs text-primary hover:underline"
              >
                {showRankings
                  ? t("connections_rankings_hide") || "Hide"
                  : t("connections_rankings_show") || "Show"}
              </button>
            </div>
            {showRankings && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    {t("connections_rankings_top_mps") || "Top MPs"}
                  </div>
                  {rankings.topMps.slice(0, 10).map((row, i) => (
                    <div
                      key={row.mpId}
                      className="text-xs flex items-center gap-2 py-0.5"
                    >
                      <span className="text-muted-foreground w-5 shrink-0 text-right">
                        {i + 1}.
                      </span>
                      <MpAvatar mpId={row.mpId} name={row.label} />
                      <Link
                        to={`/candidate/${encodeURIComponent(row.label)}`}
                        className="hover:underline truncate flex-1"
                      >
                        {row.label}
                      </Link>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {row.highConfDegree}
                      </span>
                      {row.partyGroupShort && (
                        <span className="text-muted-foreground text-[10px] truncate max-w-[120px] shrink-0">
                          {row.partyGroupShort}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    {t("connections_rankings_top_companies") ||
                      "Top companies"}
                  </div>
                  {rankings.topCompanies.slice(0, 10).map((row, i) => (
                    <div
                      key={row.nodeId}
                      className="text-xs flex items-baseline gap-2 py-0.5"
                    >
                      <span className="text-muted-foreground w-5 shrink-0 text-right">
                        {i + 1}.
                      </span>
                      {row.slug ? (
                        <Link
                          to={`/mp/company/${encodeURIComponent(row.slug)}`}
                          className="hover:underline truncate flex-1"
                        >
                          {row.label}
                        </Link>
                      ) : (
                        <span className="truncate flex-1">{row.label}</span>
                      )}
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {row.mpCount}{" "}
                        {(t("connections_legend_mp") || "MP").toLowerCase()}
                      </span>
                      {row.seat && (
                        <span className="text-muted-foreground text-[10px] truncate max-w-[100px] shrink-0">
                          {row.seat}
                        </span>
                      )}
                    </div>
                  ))}
                  <div className="mt-2 pt-2 border-t">
                    <Link
                      to="/mp/companies"
                      className="text-xs text-primary hover:underline"
                    >
                      {t("connections_rankings_view_all") || "View all"} →
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="my-4">
        <CardContent className="p-3 md:p-4">
          <div className="flex flex-wrap gap-3 items-center text-xs text-muted-foreground mb-3">
            <span>
              <span className="inline-block h-2 w-2 rounded-full bg-blue-600 mr-1 align-middle" />
              {t("connections_legend_mp") || "MP"}
              {": "}
              {stats.mp}
            </span>
            <span>
              <span className="inline-block h-2 w-2 rounded-full bg-amber-600 mr-1 align-middle" />
              {t("connections_legend_company") || "Company"}
              {": "}
              {stats.company}
            </span>
            <span>
              <span className="inline-block h-2 w-2 rounded-full bg-neutral-500 mr-1 align-middle" />
              {t("connections_legend_person") || "Other person"}
              {": "}
              {stats.person}
            </span>
            <span>
              {t("connections_legend_edges") || "Edges"}
              {": "}
              {stats.edges}
            </span>
            <span className="ml-auto flex gap-3 flex-wrap">
              <label className="inline-flex gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.showCurrentOnly}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      showCurrentOnly: e.target.checked,
                    }))
                  }
                />
                {t("connections_filter_current_only") || "Current only"}
              </label>
              <label className="inline-flex gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.hideTransferred}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      hideTransferred: e.target.checked,
                    }))
                  }
                />
                {t("connections_filter_hide_transferred") || "Hide transfers"}
              </label>
              <label className="inline-flex gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.highConfidenceOnly}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      highConfidenceOnly: e.target.checked,
                    }))
                  }
                />
                {t("connections_filter_high_confidence_only") ||
                  "High confidence only"}
              </label>
              <label className="inline-flex gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.largestComponentOnly}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      largestComponentOnly: e.target.checked,
                    }))
                  }
                />
                {t("connections_filter_largest_component") ||
                  "Largest component only"}
              </label>
              <label className="inline-flex gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clusterByParty}
                  onChange={(e) => setClusterByParty(e.target.checked)}
                />
                {t("connections_cluster_by_party") || "Cluster by party"}
              </label>
            </span>
          </div>

          <div className="flex flex-wrap gap-2 items-center text-xs mb-3 relative">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSearchSuggestions(true);
                }}
                onFocus={() => setShowSearchSuggestions(true)}
                onBlur={() =>
                  setTimeout(() => setShowSearchSuggestions(false), 150)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && searchSuggestions.length > 0) {
                    focusNode(searchSuggestions[0]);
                  } else if (e.key === "Escape") {
                    setSearchQuery("");
                    setShowSearchSuggestions(false);
                  }
                }}
                placeholder={t("connections_search_placeholder") || "Search node…"}
                className="px-2 py-1 rounded border border-border bg-background w-64"
              />
              {showSearchSuggestions && searchSuggestions.length > 0 && (
                <div className="absolute top-full left-0 mt-1 z-10 w-64 bg-card border border-border rounded shadow-md max-h-64 overflow-y-auto">
                  {searchSuggestions.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        focusNode(n);
                      }}
                      className="w-full text-left px-2 py-1.5 hover:bg-muted flex items-center gap-2 truncate"
                    >
                      {n.type === "mp" ? (
                        <MpAvatar mpId={n.mpId} name={n.label} />
                      ) : (
                        <span
                          className="inline-block h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: TYPE_COLORS[n.type] }}
                        />
                      )}
                      <span className="truncate">{n.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center text-xs mb-3">
            <button
              type="button"
              onClick={() => {
                setPathPickMode(true);
                setPathFrom(null);
                setPathTo(null);
              }}
              className={`px-2 py-1 rounded border ${
                pathPickMode
                  ? "bg-red-50 border-red-300 dark:bg-red-950/30 dark:border-red-700"
                  : "border-border hover:bg-muted"
              }`}
            >
              {t("connections_find_path") || "Find connection between two MPs"}
            </button>
            {pathPickMode && (
              <span className="text-muted-foreground italic">
                {!pathFrom
                  ? t("connections_pick_first_mp") || "Click an MP node…"
                  : !pathTo
                    ? t("connections_pick_second_mp") ||
                      "Click another MP node…"
                    : ""}
              </span>
            )}
            {(pathFrom || pathTo) && (
              <button
                type="button"
                onClick={() => {
                  setPathFrom(null);
                  setPathTo(null);
                  setPathPickMode(false);
                }}
                className="px-2 py-1 rounded border border-border hover:bg-muted"
              >
                {t("connections_clear_path") || "Clear"}
              </button>
            )}
            {pathFrom && pathTo && pathNodeIds && pathEdgeKeys && (
              <span className="text-muted-foreground">
                {pathEdgeKeys.size === 0
                  ? t("connections_no_path") ||
                    "No path between these two MPs"
                  : `${pathFrom.label} → ${pathTo.label}: ${pathNodeIds.size - 1} ${t("connections_hops") || "hop(s)"}`}
              </span>
            )}
          </div>

          {isLoading || !graph ? (
            <div
              className="text-sm text-muted-foreground"
              style={{ height: size.h }}
            >
              {t("loading") || "Loading…"}
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              onMouseMove={onMouseMove}
              onMouseDown={onMouseDown}
              onMouseUp={onMouseUp}
              onMouseLeave={() => {
                draggingRef.current = null;
                lastMouseRef.current = null;
                hoveredIdRef.current = null;
                setHovered(null);
              }}
              onWheel={onWheel}
              className="w-full border rounded select-none"
              style={{ width: size.w, height: size.h, touchAction: "none" }}
            />
          )}
        </CardContent>
      </Card>

      {detail && (
        <Card className="my-4">
          <CardContent className="p-3 md:p-4">
            <div className="text-sm font-semibold flex items-center gap-2">
              {detail.type === "mp" ? (
                <MpAvatar
                  mpId={detail.mpId}
                  name={detail.label}
                  className="h-6 w-6"
                />
              ) : (
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: TYPE_COLORS[detail.type] }}
                />
              )}
              {detail.type === "mp" ? (
                <Link
                  to={`/candidate/${encodeURIComponent(detail.label)}`}
                  className="hover:underline"
                >
                  {detail.label}
                </Link>
              ) : detail.type === "company" && detail.slug ? (
                <Link
                  to={`/mp/company/${encodeURIComponent(detail.slug)}`}
                  className="hover:underline"
                >
                  {detail.label}
                </Link>
              ) : (
                detail.label
              )}
              <span className="text-xs text-muted-foreground font-normal">
                {detail.type === "mp"
                  ? (t("connections_legend_mp") || "MP") +
                    (detail.partyGroupShort
                      ? ` · ${detail.partyGroupShort}`
                      : "")
                  : detail.type === "company"
                    ? `${t("connections_legend_company") || "Company"}${
                        detail.legalForm ? ` · ${detail.legalForm}` : ""
                      }${detail.uic ? ` · ${detail.uic}` : ""}`
                    : t("connections_legend_person") || "Other person"}
              </span>
            </div>

            <div className="text-xs text-muted-foreground mt-2">
              {t("connections_neighbors") || "Connections"}: {detailNeighbors.length}
            </div>
            <div className="text-xs mt-1 grid grid-cols-1 md:grid-cols-2 gap-x-4">
              {detailNeighbors.slice(0, 24).map((n) => (
                <div key={n.id} className="truncate flex items-center gap-1.5">
                  {n.type === "mp" ? (
                    <MpAvatar
                      mpId={n.mpId}
                      name={n.label}
                      className="h-4 w-4"
                    />
                  ) : (
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full align-middle"
                      style={{ backgroundColor: TYPE_COLORS[n.type] }}
                    />
                  )}
                  {n.type === "mp" ? (
                    <Link
                      to={`/candidate/${encodeURIComponent(n.label)}`}
                      className="hover:underline"
                    >
                      {n.label}
                    </Link>
                  ) : n.type === "company" && n.slug ? (
                    <Link
                      to={`/mp/company/${encodeURIComponent(n.slug)}`}
                      className="hover:underline"
                    >
                      {n.label}
                    </Link>
                  ) : (
                    n.label
                  )}
                </div>
              ))}
              {detailNeighbors.length > 24 && (
                <div className="text-muted-foreground italic">
                  +{detailNeighbors.length - 24} {t("more") || "more"}…
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
