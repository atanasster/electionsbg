import { FC, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./datamap.css";
import {
  dataMapClosure,
  dataMapLensColor,
  type DataMapKind,
  type DataMapLens,
  type DataMapManifest,
} from "@/data/dataMap/useDataMap";
import {
  DataMapNodeCard,
  DataMapTierFrame,
  type NodeStatus,
} from "./DataMapNodeCard";

const nodeTypes = { card: DataMapNodeCard, tier: DataMapTierFrame };

type Props = {
  manifest: DataMapManifest;
  lang: "bg" | "en";
  selectedId: string | null;
  viewTag: string | null;
  /** node id → ISO date of the latest runtime-detected refresh */
  freshness: Map<string, string>;
  freshLabel: string;
  kindLabels: Record<DataMapKind, string>;
  lens: DataMapLens;
  onSelect: (id: string | null) => void;
};

// A node counts as "recently updated" when its freshest source changed
// within the last 7 days.
const FRESH_WINDOW_MS = 7 * 24 * 3600 * 1000;

// The canvas is sized to the graph's aspect ratio, so on desktop the whole
// map is readable at ~1:1 and the camera stays still during selection
// (dimming and arrows carry the lineage); it re-fits only when the pane is
// resized. On narrow panes the base zoom is too small to read, so there a
// selection zooms the camera to the closure instead.
const MOBILE_PANE_PX = 700;

const CameraDirector: FC<{ focusIds: string[] }> = ({ focusIds }) => {
  const { fitView } = useReactFlow();
  const dims = useStore((s) => `${s.width}x${s.height}`);
  const narrow = useStore((s) => s.width > 0 && s.width < MOBILE_PANE_PX);
  const focusKey = narrow ? focusIds.join(",") : "";
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (narrow && focusIds.length) {
        fitView({
          nodes: focusIds.map((id) => ({ id })),
          duration: 500,
          padding: 0.15,
          maxZoom: 1,
        });
      } else {
        fitView({ duration: 300, padding: 0.03, maxZoom: 1.15 });
      }
    }, 30);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitView, dims, narrow, focusKey]);
  return null;
};

const InnerCanvas: FC<Props> = ({
  manifest,
  lang,
  selectedId,
  viewTag,
  freshness,
  freshLabel,
  kindLabels,
  lens,
  onSelect,
}) => {
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Stable per-mount timestamp: freshness is a day-grain signal, and a live
  // Date.now() in render would invalidate the node memo on every hover.
  const [now] = useState(() => Date.now());

  const closure = useMemo(
    () => (selectedId ? dataMapClosure(manifest.edges, selectedId) : null),
    [manifest.edges, selectedId],
  );
  const hoverClosure = useMemo(
    () =>
      !selectedId && hoverId ? dataMapClosure(manifest.edges, hoverId) : null,
    [manifest.edges, selectedId, hoverId],
  );

  const viewIds = useMemo(() => {
    if (!viewTag) return null;
    return new Set(
      manifest.nodes.filter((n) => n.tags.includes(viewTag)).map((n) => n.id),
    );
  }, [manifest.nodes, viewTag]);

  const nodes: Node[] = useMemo(() => {
    const tierNodes: Node[] = manifest.tiers.map((t) => ({
      id: `tier:${t.kind}`,
      type: "tier",
      position: { x: t.x, y: t.y },
      width: t.w,
      height: t.h,
      data: { label: t.label[lang] },
      draggable: false,
      selectable: false,
      focusable: false,
      style: { pointerEvents: "none" as const, zIndex: -1 },
    }));

    const cardNodes: Node[] = manifest.nodes.map((n) => {
      let status: NodeStatus = "base";
      if (selectedId) {
        status =
          n.id === selectedId ? "selected" : closure?.has(n.id) ? "hot" : "dim";
      } else if (viewIds) {
        status = viewIds.has(n.id) ? "base" : "dim";
      }
      const freshAt = freshness.get(n.id) ?? n.freshness;
      const fresh =
        !!freshAt && now - new Date(freshAt).getTime() < FRESH_WINDOW_MS;
      const lensColor =
        lens === "none" ? undefined : dataMapLensColor(lens, n, freshAt, now);
      return {
        id: n.id,
        type: "card",
        position: { x: n.x, y: n.y },
        width: n.w,
        height: n.h,
        data: {
          node: n,
          lang,
          status,
          fresh,
          freshTitle: fresh
            ? `${freshLabel}: ${freshAt!.slice(0, 10)}`
            : undefined,
          kindLabel: kindLabels[n.kind],
          lensColor,
          onActivate: (id: string) => onSelect(id === selectedId ? null : id),
        },
        draggable: false,
        selectable: false,
        // The card itself is the focus target (role="button"); keeping the
        // React Flow wrapper focusable too would create double tab stops.
        focusable: false,
      };
    });

    return [...tierNodes, ...cardNodes];
  }, [
    manifest,
    lang,
    selectedId,
    closure,
    viewIds,
    freshness,
    freshLabel,
    kindLabels,
    lens,
    onSelect,
    now,
  ]);

  const edges: Edge[] = useMemo(
    () =>
      manifest.edges.map((e) => {
        let status: NodeStatus = "base";
        if (closure) {
          status = closure.has(e.from) && closure.has(e.to) ? "hot" : "dim";
        } else if (hoverClosure) {
          status =
            hoverClosure.has(e.from) && hoverClosure.has(e.to) ? "hot" : "base";
        } else if (viewIds) {
          status = viewIds.has(e.from) && viewIds.has(e.to) ? "base" : "dim";
        }
        const hot = status === "hot";
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          animated: hot && !!closure,
          style: hot
            ? { stroke: "hsl(var(--accent))", strokeWidth: 2, opacity: 0.9 }
            : status === "dim"
              ? {
                  stroke: "hsl(var(--muted-foreground))",
                  strokeWidth: 1.2,
                  opacity: 0.05,
                }
              : {
                  stroke: "hsl(var(--muted-foreground))",
                  strokeWidth: 1.2,
                  opacity: 0.3,
                },
          markerEnd: hot
            ? {
                type: MarkerType.ArrowClosed,
                color: "hsl(var(--accent))",
                width: 14,
                height: 14,
              }
            : undefined,
        };
      }),
    [manifest.edges, closure, hoverClosure, viewIds],
  );

  // The absolute fill wrapper gives React Flow a definite height — the
  // screen's outer container is a flex item, where a bare percentage-height
  // chain collapses to 0.
  return (
    <div className="absolute inset-0">
      <ReactFlow
        className="datamap-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.03, maxZoom: 1.15 }}
        minZoom={0.12}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        panOnDrag
        onNodeClick={(_, node) => {
          if (node.type === "card")
            onSelect(node.id === selectedId ? null : node.id);
        }}
        onPaneClick={() => onSelect(null)}
        onNodeMouseEnter={(_, node) => {
          if (node.type === "card") setHoverId(node.id);
        }}
        onNodeMouseLeave={() => setHoverId(null)}
        proOptions={{ hideAttribution: false }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={26}
          size={1.5}
          color="hsl(var(--border))"
        />
        <Controls showInteractive={false} position="bottom-right" />
        <CameraDirector focusIds={closure ? [...closure] : []} />
      </ReactFlow>
    </div>
  );
};

export const DataMapCanvas: FC<Props> = (props) => (
  <ReactFlowProvider>
    <InnerCanvas {...props} />
  </ReactFlowProvider>
);
