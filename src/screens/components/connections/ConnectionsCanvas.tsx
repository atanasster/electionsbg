import {
  FC,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { SimulationNodeDatum, SimulationLinkDatum } from "d3-force";
import type { ConnectionsEdge, ConnectionsNode } from "@/data/dataTypes";
import { MpAvatar } from "@/screens/components/candidates/MpAvatar";
import { initials } from "@/lib/utils";
import { useMps } from "@/data/parliament/useMps";
import { useParliamentGroups } from "@/data/parliament/useParliamentGroups";

/** d3-force mutates nodes in place — extend our typed node with sim fields. */
export type ConnectionsSimNode = ConnectionsNode &
  SimulationNodeDatum & {
    radius: number;
    color: string;
  };
export type ConnectionsSimLink = SimulationLinkDatum<ConnectionsSimNode> &
  ConnectionsEdge;

const TYPE_COLORS: Record<ConnectionsNode["type"], string> = {
  mp: "#2563eb",
  company: "#d97706",
  person: "#737373",
};

type Props = {
  simNodes: ConnectionsSimNode[];
  simLinks: ConnectionsSimLink[];
  /** Adjacency map keyed by node id → set of neighbor ids. Drives the popover
   * neighbors list and the hover-highlight set. */
  neighbors: Map<string, Set<string>>;
  /** When provided, this node gets a black ring (used to mark the candidate's
   * hub MP on the per-MP page). Purely visual — pinning at origin is the
   * caller's job (set fx/fy on the simNode). */
  pinNodeId?: string;
  /** Optional path overlay (red) — same semantics as on `/connections`. */
  pathNodeIds?: Set<string> | null;
  pathEdgeKeys?: Set<string> | null;
  pathEndpoints?: {
    from?: ConnectionsSimNode | null;
    to?: ConnectionsSimNode | null;
  };
  /** Fixed pixel height. Width is derived from the container's bounding box
   * via ResizeObserver. */
  height: number;
  /** Min container width fallback before the ResizeObserver settles. */
  minWidth?: number;
  /** Optional callback fired on a no-drag click on a node. The shared canvas
   * still updates `selected` internally — this hook is for path-pick mode
   * etc. */
  onNodeClick?: (node: ConnectionsSimNode | null) => void;
  className?: string;
  style?: CSSProperties;
};

/** Shared pan/zoom + popover canvas used by `/connections` and the
 * candidate-page mini-graph. The caller owns the d3-force simulation and
 * passes already-stepped sim nodes/links; this component only renders and
 * handles interaction. */
export const ConnectionsCanvas: FC<Props> = ({
  simNodes,
  simLinks,
  neighbors,
  pinNodeId,
  pathNodeIds = null,
  pathEdgeKeys = null,
  pathEndpoints,
  height,
  minWidth = 280,
  onNodeClick,
  className,
  style,
}) => {
  const { t } = useTranslation();
  const { findMpById, findMpByName } = useMps();
  const { lookup: lookupGroup } = useParliamentGroups();

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Cache of MP photo images by URL so the RAF loop can render synchronously.
  // Map value === null means "load failed"; HTMLImageElement may still be
  // loading (check img.complete && img.naturalWidth > 0 before drawing).
  const imageCacheRef = useRef<Map<string, HTMLImageElement | null>>(new Map());

  const getMpImage = (url: string): HTMLImageElement | null => {
    const cache = imageCacheRef.current;
    if (cache.has(url)) return cache.get(url) ?? null;
    const img = new Image();
    img.onerror = () => cache.set(url, null);
    img.src = url;
    cache.set(url, img);
    return img;
  };

  // Camera in plain refs so the RAF render loop can read it without React
  // re-renders firing every frame.
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 });
  const draggingRef = useRef<{ kind: "pan" | "node"; nodeId?: string } | null>(
    null,
  );
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  const cursorOnCanvasRef = useRef<{ x: number; y: number } | null>(null);
  const hoveredIdRef = useRef<string | null>(null);

  const [width, setWidth] = useState(640);
  const [hovered, setHovered] = useState<ConnectionsSimNode | null>(null);
  const [selected, setSelected] = useState<ConnectionsSimNode | null>(null);
  const [popoverCorner, setPopoverCorner] = useState<"tl" | "tr" | "bl" | "br">(
    "br",
  );
  const [visibleVRange, setVisibleVRange] = useState<{
    top: number;
    bottom: number;
  }>({ top: 0, bottom: height });

  // ResizeObserver for the container width so the canvas grows with the card.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(
        Math.max(minWidth, Math.floor(el.getBoundingClientRect().width)),
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [minWidth]);

  // Keep the popover anchored inside the visible vertical slice of the canvas
  // (it can extend past the fold, especially the full /connections graph).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const top = Math.max(0, -r.top);
      const bottom = Math.min(r.height, window.innerHeight - r.top);
      setVisibleVRange((prev) =>
        prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
      );
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [height]);

  // Re-center camera when the simulation node set changes (graph swap).
  // Keeps the hub roughly visible on first paint without a flash of empty.
  useEffect(() => {
    cameraRef.current = { x: 0, y: 0, scale: 1 };
  }, [simNodes]);

  // RAF render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;

    const draw = () => {
      const w = width;
      const h = height;
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
      const highlightSet =
        pathNodeIds ??
        (hoveredId
          ? new Set([hoveredId, ...(neighbors.get(hoveredId) ?? [])])
          : null);

      // Edges
      ctx.lineWidth = 0.5 / cam.scale;
      for (const link of simLinks) {
        const s = link.source as ConnectionsSimNode;
        const tn = link.target as ConnectionsSimNode;
        if (s.x == null || tn.x == null) continue;
        const onPath = pathEdgeKeys && pathEdgeKeys.has(`${s.id}|${tn.id}`);
        const dimmed =
          highlightSet &&
          !onPath &&
          !(highlightSet.has(s.id) && highlightSet.has(tn.id));
        if (onPath) {
          ctx.strokeStyle = "#dc2626";
          ctx.lineWidth = 2 / cam.scale;
        } else {
          ctx.strokeStyle = dimmed
            ? "rgba(120,120,120,0.08)"
            : link.kind === "declared_stake"
              ? "rgba(37,99,235,0.45)"
              : "rgba(217,119,6,0.45)";
          ctx.lineWidth = 0.5 / cam.scale;
        }
        ctx.setLineDash(link.isCurrent ? [] : [3, 3]);
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
        const dimmed = !!(highlightSet && !onPath && !highlightSet.has(n.id));
        const r = onPath ? n.radius + 1.5 : n.radius;
        const isHub = n.id === pinNodeId;
        const isEndpoint =
          n.id === pathEndpoints?.from?.id || n.id === pathEndpoints?.to?.id;

        if (n.type === "mp") {
          const mp = findMpById(n.mpId) ?? findMpByName(n.label);
          const group = lookupGroup(
            mp?.currentPartyGroupShort ?? n.partyGroupShort,
          );
          const ringWidth = Math.max(0.8, r * 0.18);
          const innerR = Math.max(1, r - ringWidth);
          const ringColor = onPath
            ? "#dc2626"
            : dimmed
              ? "rgba(170,170,170,0.6)"
              : (group?.color ?? n.color);

          // Party-coloured ring
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.fillStyle = ringColor;
          ctx.fill();

          // Avatar interior (photo or initials)
          const img = mp?.photoUrl ? getMpImage(mp.photoUrl) : null;
          ctx.save();
          ctx.beginPath();
          ctx.arc(n.x, n.y, innerR, 0, Math.PI * 2);
          ctx.clip();
          if (img && img.complete && img.naturalWidth > 0) {
            if (dimmed) ctx.globalAlpha = 0.45;
            ctx.drawImage(
              img,
              n.x - innerR,
              n.y - innerR,
              innerR * 2,
              innerR * 2,
            );
          } else {
            ctx.fillStyle = dimmed ? "rgba(220,220,220,0.6)" : "#f5f5f4";
            ctx.fill();
            const text = initials(mp?.name ?? n.label);
            if (text && innerR * cam.scale > 4) {
              ctx.fillStyle = dimmed ? "rgba(80,80,80,0.7)" : "#3f3f46";
              ctx.font = `bold ${innerR * 1.0}px system-ui, sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(text, n.x, n.y);
            }
          }
          ctx.restore();
          // Restore label-drawing defaults touched inside save/restore is not
          // needed since save/restore covers them; the loop continues.
        } else {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.fillStyle = dimmed
            ? "rgba(170,170,170,0.4)"
            : onPath
              ? "#dc2626"
              : n.color;
          ctx.fill();
        }

        if (selected?.id === n.id || isEndpoint || isHub) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = isEndpoint ? "#dc2626" : "#000";
          ctx.lineWidth = (isHub ? 2.5 : 2) / cam.scale;
          ctx.stroke();
          ctx.lineWidth = 0.5 / cam.scale;
        }
      }

      // Labels — hub, hovered, selected, MPs, and any high-degree node.
      ctx.fillStyle = "#222";
      ctx.font = `${11 / cam.scale}px system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      for (const n of simNodes) {
        if (n.x == null || n.y == null) continue;
        const isHub = n.id === pinNodeId;
        const isImportant =
          isHub ||
          n.id === hoveredId ||
          n.id === selected?.id ||
          n.type === "mp" ||
          n.radius > 6 / cam.scale + 2;
        if (!isImportant) continue;
        ctx.fillText(n.label, n.x + n.radius + 2, n.y);
      }

      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [
    width,
    height,
    simNodes,
    simLinks,
    neighbors,
    pinNodeId,
    selected,
    pathNodeIds,
    pathEdgeKeys,
    pathEndpoints?.from?.id,
    pathEndpoints?.to?.id,
    findMpById,
    findMpByName,
    lookupGroup,
  ]);

  // Choose popover corner only when the popover transitions from hidden to
  // visible — keeps it from jumping while the user moves between nodes.
  const detail = selected ?? hovered;
  const detailVisible = !!detail;
  const wasDetailVisibleRef = useRef(false);
  useEffect(() => {
    if (!detailVisible) {
      wasDetailVisibleRef.current = false;
      return;
    }
    if (wasDetailVisibleRef.current) return;
    wasDetailVisibleRef.current = true;
    const c = cursorOnCanvasRef.current;
    if (!c || width === 0 || height === 0) return;
    const left = c.x < width / 2;
    const visMidY =
      visibleVRange.bottom > visibleVRange.top
        ? (visibleVRange.top + visibleVRange.bottom) / 2
        : height / 2;
    const top = c.y < visMidY;
    setPopoverCorner(top ? (left ? "br" : "bl") : left ? "tr" : "tl");
  }, [detailVisible, width, height, visibleVRange.top, visibleVRange.bottom]);

  const detailNeighbors = useMemo<ConnectionsSimNode[]>(() => {
    if (!detail) return [];
    const ids = neighbors.get(detail.id) ?? new Set<string>();
    const byId = new Map<string, ConnectionsSimNode>();
    for (const n of simNodes) byId.set(n.id, n);
    const out: ConnectionsSimNode[] = [];
    for (const id of ids) {
      const n = byId.get(id);
      if (n) out.push(n);
    }
    // MPs first, then companies, then persons; alphabetical inside.
    const order = { mp: 0, company: 1, person: 2 } as const;
    out.sort(
      (a, b) =>
        order[a.type] - order[b.type] || a.label.localeCompare(b.label, "bg"),
    );
    return out;
  }, [detail, neighbors, simNodes]);

  // ---- Mouse interactions ----

  const screenToWorld = (sx: number, sy: number) => {
    const cam = cameraRef.current;
    return {
      x: (sx - width / 2 - cam.x) / cam.scale,
      y: (sy - height / 2 - cam.y) / cam.scale,
    };
  };

  const findNodeAt = (sx: number, sy: number): ConnectionsSimNode | null => {
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
      }
      lastMouseRef.current = { x: sx, y: sy };
      return;
    }
    cursorOnCanvasRef.current = { x: sx, y: sy };
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
      // Don't pin the hub — its caller-supplied fx/fy must persist.
      if (node.id !== pinNodeId) {
        draggingRef.current = { kind: "node", nodeId: node.id };
      } else {
        draggingRef.current = { kind: "pan" };
      }
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
    if (drag?.kind === "node" && drag.nodeId && drag.nodeId !== pinNodeId) {
      const n = simNodes.find((nn) => nn.id === drag.nodeId);
      if (n) {
        n.fx = null;
        n.fy = null;
      }
    }
    if (last && Math.abs(sx - last.x) < 3 && Math.abs(sy - last.y) < 3) {
      const node = findNodeAt(sx, sy);
      setSelected(node);
      onNodeClick?.(node);
    }
    draggingRef.current = null;
    lastMouseRef.current = null;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const cam = cameraRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wx = (sx - width / 2 - cam.x) / cam.scale;
    const wy = (sy - height / 2 - cam.y) / cam.scale;
    const factor = Math.exp(-e.deltaY * 0.01);
    const newScale = Math.max(0.2, Math.min(5, cam.scale * factor));
    cam.x = sx - width / 2 - wx * newScale;
    cam.y = sy - height / 2 - wy * newScale;
    cam.scale = newScale;
  };

  return (
    <div ref={wrapRef} className={className} style={style}>
      <div className="relative">
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
          className="block border rounded select-none w-full"
          style={{ width, height, touchAction: "none" }}
        />
        {detail ? (
          <div
            className="absolute z-10 bg-card/95 backdrop-blur-sm border rounded-md shadow-lg p-3 overflow-y-auto"
            style={{
              ...(popoverCorner === "tl" || popoverCorner === "tr"
                ? { top: visibleVRange.top + 8 }
                : {
                    bottom: Math.max(0, height - visibleVRange.bottom) + 8,
                  }),
              ...(popoverCorner === "tl" || popoverCorner === "bl"
                ? { left: 8 }
                : { right: 8 }),
              maxWidth: Math.min(360, Math.max(220, width - 16)),
              maxHeight: Math.max(
                160,
                Math.floor(
                  (visibleVRange.bottom - visibleVRange.top || height) * 0.6,
                ),
              ),
            }}
          >
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
                  className="hover:underline truncate"
                >
                  {detail.label}
                </Link>
              ) : detail.type === "company" && detail.slug ? (
                <Link
                  to={`/mp/company/${encodeURIComponent(detail.slug)}`}
                  className="hover:underline truncate"
                >
                  {detail.label}
                </Link>
              ) : (
                <span className="truncate">{detail.label}</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {detail.type === "mp"
                ? (t("connections_legend_mp") || "MP") +
                  (detail.partyGroupShort ? ` · ${detail.partyGroupShort}` : "")
                : detail.type === "company"
                  ? `${t("connections_legend_company") || "Company"}${
                      detail.legalForm ? ` · ${detail.legalForm}` : ""
                    }${detail.uic ? ` · ${detail.uic}` : ""}`
                  : t("connections_legend_person") || "Other person"}
            </div>

            <div className="text-xs text-muted-foreground mt-2">
              {t("connections_neighbors") || "Connections"}:{" "}
              {detailNeighbors.length}
            </div>
            <div className="text-xs mt-1 flex flex-col gap-0.5">
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
                      className="inline-block h-1.5 w-1.5 rounded-full align-middle shrink-0"
                      style={{ backgroundColor: TYPE_COLORS[n.type] }}
                    />
                  )}
                  {n.type === "mp" ? (
                    <Link
                      to={`/candidate/${encodeURIComponent(n.label)}`}
                      className="hover:underline truncate"
                    >
                      {n.label}
                    </Link>
                  ) : n.type === "company" && n.slug ? (
                    <Link
                      to={`/mp/company/${encodeURIComponent(n.slug)}`}
                      className="hover:underline truncate"
                    >
                      {n.label}
                    </Link>
                  ) : (
                    <span className="truncate">{n.label}</span>
                  )}
                </div>
              ))}
              {detailNeighbors.length > 24 && (
                <div className="text-muted-foreground italic">
                  +{detailNeighbors.length - 24} {t("more") || "more"}…
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
