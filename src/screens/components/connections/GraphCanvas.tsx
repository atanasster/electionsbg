// A lean d3-force canvas for the /connections graph engine (P4.1). Renders the blob-native person↔
// company view (GraphView from graphBlob.ts) — facet/party-coloured people, amber companies, edges,
// with pan/zoom (mouse + touch), click-to-select, and a highlighted BFS path. Deliberately simpler
// than the retired full-graph inline canvas: the down-sampled blob is ~150 companies + ~350 people.
//
// The force simulation runs on the WHOLE view and is NOT rebuilt when facets are toggled — hiding is a
// DRAW/hit-test concern only, so positions are preserved (no relayout flicker) and the hidden set
// matches exactly what the BFS path-finder blocks (graphBlob.hiddenNodeIds). The draw loop idles when
// the sim has settled and nothing is dirty, instead of repainting ~500 nodes at 60fps forever.

import { FC, useEffect, useRef } from "react";
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import {
  pathEdgeKey,
  type GraphView,
  type GraphViewNode,
} from "@/data/parliament/graphBlob";

type SimNode = GraphViewNode & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & { kind: string };

type Props = {
  view: GraphView;
  selectedId: string | null;
  pathIds: Set<string>;
  pathEdges: Set<string>; // "a|b" (both orderings) for edges on the path
  hiddenFacets: Set<string>;
  onSelect: (node: GraphViewNode | null) => void;
  height?: number;
};

const isDark = (): boolean =>
  typeof document !== "undefined" &&
  document.documentElement.classList.contains("dark");

export const GraphCanvas: FC<Props> = ({
  view,
  selectedId,
  pathIds,
  pathEdges,
  hiddenFacets,
  onSelect,
  height = 560,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 });
  const sizeRef = useRef({ w: 0, h: height });
  const hoverRef = useRef<string | null>(null);
  const dirtyRef = useRef(true); // force at least one paint

  // Latest-props refs so the single long-lived draw loop reads current values without re-subscribing.
  const propsRef = useRef({ selectedId, pathIds, pathEdges, hiddenFacets });
  propsRef.current = { selectedId, pathIds, pathEdges, hiddenFacets };
  useEffect(() => {
    dirtyRef.current = true;
  }, [selectedId, pathIds, pathEdges, hiddenFacets, height]);

  // The sim runs on the FULL view (stable positions across facet toggles).
  const simNodes = useRef<SimNode[]>([]);
  const simLinks = useRef<SimLink[]>([]);
  const simRef = useRef<ReturnType<
    typeof forceSimulation<SimNode, SimLink>
  > | null>(null);

  useEffect(() => {
    const nodes: SimNode[] = view.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = view.edges.map((e) => ({
      source: e.source,
      target: e.target,
      kind: e.kind,
    }));
    simNodes.current = nodes;
    simLinks.current = links;
    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(70)
          .strength(0.35),
      )
      .force("charge", forceManyBody().strength(-90))
      .force("center", forceCenter(0, 0))
      .force("x", forceX<SimNode>(0).strength(0.05))
      .force("y", forceY<SimNode>(0).strength(0.05))
      .alpha(1)
      .alphaDecay(0.025);
    simRef.current = sim;
    dirtyRef.current = true;
    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [view]);

  // Which nodes/edges are visible under the current facet filter — recomputed each draw (cheap for
  // ~500 nodes) so it always matches propsRef.
  const visibility = () => {
    const hidden = new Set<string>();
    const { hiddenFacets: hf } = propsRef.current;
    for (const n of simNodes.current)
      if (n.kind === "person" && hf.has(n.facet ?? "")) hidden.add(n.id);
    const visibleCompany = new Set<string>();
    if (hidden.size)
      for (const l of simLinks.current) {
        const s = (l.source as SimNode).id ?? (l.source as unknown as string);
        const t = (l.target as SimNode).id ?? (l.target as unknown as string);
        if (!hidden.has(s) && !hidden.has(t)) {
          visibleCompany.add(s);
          visibleCompany.add(t);
        }
      }
    const nodeVisible = (n: SimNode): boolean =>
      hidden.size === 0
        ? true
        : n.kind === "person"
          ? !hidden.has(n.id)
          : visibleCompany.has(n.id);
    return { hidden, nodeVisible };
  };

  // RAF draw loop — idles when the sim is settled and nothing is dirty.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const sim = simRef.current;
      const settled = !sim || sim.alpha() <= sim.alphaMin();
      if (settled && !dirtyRef.current) {
        raf = requestAnimationFrame(draw);
        return;
      }
      dirtyRef.current = false;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.parentElement?.clientWidth ?? 800;
      const h = height;
      sizeRef.current = { w, h };
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cam = cameraRef.current;
      const {
        selectedId: selId,
        pathIds: pIds,
        pathEdges: pEdges,
      } = propsRef.current;
      const anyHighlight = pIds.size > 0 || selId != null;
      const dark = isDark();
      const labelColor = dark ? "#cbd5e1" : "#334155";
      const edgeBase = dark
        ? "rgba(148,163,184,0.35)"
        : "rgba(100,116,139,0.5)";
      const edgeDim = "rgba(148,163,184,0.18)";
      const outline = dark ? "#e5e7eb" : "#111827";
      const { nodeVisible } = visibility();

      ctx.save();
      ctx.translate(w / 2 + cam.x, h / 2 + cam.y);
      ctx.scale(cam.scale, cam.scale);

      // Edges.
      for (const l of simLinks.current) {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        if (s.x == null || t.x == null) continue;
        if (!nodeVisible(s) || !nodeVisible(t)) continue;
        const onPath =
          pEdges.has(pathEdgeKey(s.id, t.id)) ||
          pEdges.has(pathEdgeKey(t.id, s.id));
        ctx.strokeStyle = onPath
          ? "#dc2626"
          : anyHighlight
            ? edgeDim
            : edgeBase;
        ctx.lineWidth = (onPath ? 2 : 0.6) / cam.scale;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y!);
        ctx.lineTo(t.x, t.y!);
        ctx.stroke();
      }

      // Nodes.
      for (const n of simNodes.current) {
        if (n.x == null || n.y == null || !nodeVisible(n)) continue;
        const onPath = pIds.has(n.id);
        const isSel = n.id === selId || n.id === hoverRef.current;
        const dimmed = anyHighlight && !onPath && !isSel;
        ctx.beginPath();
        ctx.arc(n.x, n.y, isSel ? n.radius + 1.5 : n.radius, 0, Math.PI * 2);
        ctx.globalAlpha = dimmed ? 0.25 : 1;
        ctx.fillStyle = n.color;
        ctx.fill();
        if (isSel || onPath) {
          ctx.strokeStyle = onPath ? "#dc2626" : outline;
          ctx.lineWidth = 1.5 / cam.scale;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Labels — only larger / selected / path nodes, to avoid clutter.
      ctx.fillStyle = labelColor;
      ctx.font = `${11 / cam.scale}px system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      for (const n of simNodes.current) {
        if (n.x == null || n.y == null || !nodeVisible(n)) continue;
        const isSel = n.id === selId || n.id === hoverRef.current;
        const onPath = pIds.has(n.id);
        if (!isSel && !onPath && n.radius < 7) continue;
        if (anyHighlight && !onPath && !isSel) continue;
        ctx.fillText(n.label, n.x + n.radius + 2 / cam.scale, n.y);
      }
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [height]);

  // Native non-passive wheel listener so preventDefault actually stops page scroll while zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      cam.scale = Math.max(
        0.2,
        Math.min(5, cam.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)),
      );
      dirtyRef.current = true;
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  // ── Pointer interaction (mouse + touch, unified). One pointer pans; two pinch-zoom. A tap (no
  // movement) selects the node under it. ──────────────────────────────────────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, pinchDist: 0 });

  const nodeAt = (clientX: number, clientY: number): SimNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { w, h } = sizeRef.current;
    const cam = cameraRef.current;
    const wx = (clientX - rect.left - w / 2 - cam.x) / cam.scale;
    const wy = (clientY - rect.top - h / 2 - cam.y) / cam.scale;
    const { nodeVisible } = visibility();
    let best: SimNode | null = null;
    let bestD = Infinity;
    for (const n of simNodes.current) {
      if (n.x == null || n.y == null || !nodeVisible(n)) continue;
      const d = Math.hypot(n.x - wx, n.y - wy);
      if (d <= n.radius + 4 / cam.scale && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current.moved = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pts = pointers.current;
    const prev = pts.get(e.pointerId);
    if (!prev) {
      hoverRef.current = nodeAt(e.clientX, e.clientY)?.id ?? null;
      dirtyRef.current = true;
      return;
    }
    const cam = cameraRef.current;
    if (pts.size === 2) {
      // Pinch-zoom around the pointers' midpoint, plus pan by the midpoint delta.
      const before = [...pts.values()];
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const after = [...pts.values()];
      const d0 = gesture.current.pinchDist || 1;
      const d1 = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
      cam.scale = Math.max(0.2, Math.min(5, cam.scale * (d1 / d0)));
      gesture.current.pinchDist = d1;
      const mid0 = {
        x: (before[0].x + before[1].x) / 2,
        y: (before[0].y + before[1].y) / 2,
      };
      const mid1 = {
        x: (after[0].x + after[1].x) / 2,
        y: (after[0].y + after[1].y) / 2,
      };
      cam.x += mid1.x - mid0.x;
      cam.y += mid1.y - mid0.y;
      gesture.current.moved = true;
    } else {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) gesture.current.moved = true;
      cam.x += dx;
      cam.y += dy;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    dirtyRef.current = true;
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const had = pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0 && canvasRef.current)
      canvasRef.current.style.cursor = "grab";
    if (had && pointers.current.size === 0 && !gesture.current.moved)
      onSelect(nodeAt(e.clientX, e.clientY));
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full touch-none rounded-md bg-muted/20"
      style={{ height, cursor: "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        hoverRef.current = null;
        dirtyRef.current = true;
      }}
      aria-label="Граф на връзките"
    />
  );
};
