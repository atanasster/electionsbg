import { FC, useEffect, useRef, useState, useMemo } from "react";
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
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useMpConnections } from "@/data/parliament/useMpConnections";
import type {
  ConnectionsEdge,
  ConnectionsNode,
} from "@/data/dataTypes";

type SimNode = ConnectionsNode &
  SimulationNodeDatum & {
    radius: number;
    color: string;
  };
type SimLink = SimulationLinkDatum<SimNode> & ConnectionsEdge;

const TYPE_COLORS: Record<ConnectionsNode["type"], string> = {
  mp: "#2563eb",
  company: "#d97706",
  person: "#737373",
};

const HEIGHT = 280;

export const MpConnectionsMini: FC<{ name: string }> = ({ name }) => {
  const { t } = useTranslation();
  const { subgraph } = useMpConnections(name);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const [width, setWidth] = useState(640);
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);

  // Resize observer for responsive width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(Math.max(280, Math.floor(el.getBoundingClientRect().width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build simulation data. The hub MP is pinned at origin so the radial
  // layout is stable: the hub never wanders.
  const { simNodes, simLinks } = useMemo(() => {
    if (!subgraph) return { simNodes: [] as SimNode[], simLinks: [] as SimLink[] };
    const degree = new Map<string, number>();
    for (const e of subgraph.edges) {
      degree.set(e.source as string, (degree.get(e.source as string) ?? 0) + 1);
      degree.set(e.target as string, (degree.get(e.target as string) ?? 0) + 1);
    }
    const simNodes: SimNode[] = subgraph.nodes.map((n) => ({
      ...n,
      radius:
        n.id === subgraph.mpNodeId
          ? 8
          : 3 + Math.min(5, Math.sqrt(degree.get(n.id) ?? 1) * 1.2),
      color: TYPE_COLORS[n.type],
      // Pin the hub MP at center.
      ...(n.id === subgraph.mpNodeId ? { fx: 0, fy: 0 } : {}),
    }));
    const simLinks: SimLink[] = subgraph.edges.map((e) => ({ ...e }));
    return { simNodes, simLinks };
  }, [subgraph]);

  useEffect(() => {
    if (simNodes.length === 0) return;
    const sim = forceSimulation<SimNode, SimLink>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(50)
          .strength(0.5),
      )
      .force("charge", forceManyBody().strength(-60))
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

  // RAF render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== width * dpr || canvas.height !== HEIGHT * dpr) {
        canvas.width = width * dpr;
        canvas.height = HEIGHT * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${HEIGHT}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, HEIGHT);
      ctx.translate(width / 2, HEIGHT / 2);

      const hoveredId = hoveredIdRef.current;
      const hubId = subgraph?.mpNodeId;

      // Edges
      ctx.lineWidth = 0.6;
      for (const link of simLinks) {
        const s = link.source as SimNode;
        const tn = link.target as SimNode;
        if (s.x == null || tn.x == null) continue;
        const involvesHovered =
          hoveredId && (s.id === hoveredId || tn.id === hoveredId);
        ctx.strokeStyle = involvesHovered
          ? "rgba(220,38,38,0.7)"
          : link.kind === "declared_stake"
            ? "rgba(37,99,235,0.5)"
            : "rgba(217,119,6,0.5)";
        ctx.setLineDash(link.isCurrent ? [] : [3, 3]);
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(tn.x!, tn.y!);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Nodes
      for (const n of simNodes) {
        if (n.x == null || n.y == null) continue;
        const isHub = n.id === hubId;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
        if (isHub || n.id === hoveredId) {
          ctx.strokeStyle = isHub ? "#000" : "#dc2626";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      // Labels — only the hub MP plus first-shell companies (degree-1 connected to hub)
      ctx.fillStyle = "#222";
      ctx.font = "10px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      for (const n of simNodes) {
        if (n.x == null || n.y == null) continue;
        const isHub = n.id === hubId;
        if (!isHub && n.type !== "company") continue;
        if (!isHub && n.radius < 4) continue; // skip tiny companies
        const label =
          n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label;
        ctx.fillText(label, n.x + n.radius + 2, n.y);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, simNodes, simLinks, subgraph]);

  // Hover detection.
  const findNodeAt = (sx: number, sy: number): SimNode | null => {
    const x = sx - width / 2;
    const y = sy - HEIGHT / 2;
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
    const node = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    hoveredIdRef.current = node?.id ?? null;
    setHoveredLabel(node?.label ?? null);
    e.currentTarget.style.cursor = node ? "pointer" : "default";
  };

  if (!subgraph || subgraph.nodes.length <= 1) return null;

  // Stats: companies + non-MP persons in the immediate neighbourhood
  const companyCount = subgraph.nodes.filter((n) => n.type === "company").length;
  const personCount = subgraph.nodes.filter((n) => n.type === "person").length;
  const otherMpCount = subgraph.nodes.filter(
    (n) => n.type === "mp" && n.id !== subgraph.mpNodeId,
  ).length;

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Network className="h-4 w-4" />
          {t("mp_connections_mini_title") || "Connections graph"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {companyCount}{" "}
            {(t("connections_legend_company") || "Company").toLowerCase()}
            {personCount > 0
              ? ` · ${personCount} ${(t("connections_legend_person") || "person").toLowerCase()}`
              : ""}
            {otherMpCount > 0
              ? ` · ${otherMpCount} ${(t("connections_other_mps") || "other MP(s)").toLowerCase()}`
              : ""}
          </span>
          <Link
            to="/connections"
            className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline font-normal"
          >
            {t("mp_connections_open_full") || "Open full graph"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div ref={containerRef} className="w-full">
          <canvas
            ref={canvasRef}
            onMouseMove={onMouseMove}
            onMouseLeave={() => {
              hoveredIdRef.current = null;
              setHoveredLabel(null);
            }}
            className="w-full border rounded select-none"
            style={{ width, height: HEIGHT }}
          />
        </div>
        <div className="text-xs text-muted-foreground mt-2 min-h-[1.2em]">
          {hoveredLabel ?? t("mp_connections_mini_hint") ?? "Hover a node to inspect."}
        </div>
      </CardContent>
    </Card>
  );
};
