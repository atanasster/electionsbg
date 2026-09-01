import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConnectionMode,
  Background,
  BackgroundVariant,
  ControlButton,
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
import { Maximize } from "lucide-react";
import "./datamap.css";
import { formatCount } from "@/lib/currency";
import {
  dataMapClosure,
  dataMapLinkNeighbours,
  DATA_MAP_KEY_COLOR,
  dataMapLensColor,
  type DataMapKind,
  type DataMapLens,
  type DataMapManifest,
} from "@/data/dataMap/useDataMap";
import {
  dataMapBounds,
  dataMapGraphBounds,
  viewportForBounds,
  type DataMapBox,
} from "@/data/dataMap/viewport";
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
  /** Accessible name for the fit-view control — see the Controls block below. */
  fitLabel: string;
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

// Framing constants. The pane's own limits are wider than the framing's so a
// reader can still zoom past a fit in either direction with the controls.
const PANE_MIN_ZOOM = 0.12;
const PANE_MAX_ZOOM = 2;
const FIT_PADDING = 0.03;
const FIT_MAX_ZOOM = 1.15;
const FOCUS_PADDING = 0.15;
const FOCUS_MAX_ZOOM = 1;

/**
 * Frames the graph in the pane.
 *
 * It computes the transform itself and calls `setViewport` rather than asking
 * React Flow to `fitView`, because fitView does not work on this canvas: on
 * first paint the flow logs error #004 and leaves the viewport at the identity
 * transform, so the portrait graph rendered at 1:1 anchored top-left — most of
 * it off-canvas on a phone. At that point the zoom buttons work and a fitView
 * does nothing, so the pane dimensions are sound and the node BOUNDS are what
 * fitView cannot resolve; the manifest carries every box, so they never needed
 * measuring. (fitView recovers once the nodes have painted, which is why the
 * fit CONTROL needed its own treatment rather than the same one — see the
 * Controls block below.) See src/data/dataMap/viewport.ts for the measurements.
 */
const CameraDirector: FC<{
  manifest: DataMapManifest;
  focusIds: string[];
  /** Bumped by the fit control, which this component owns outright. */
  frameNonce: number;
}> = ({ manifest, focusIds, frameNonce }) => {
  const { setViewport } = useReactFlow();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const narrow = width > 0 && width < MOBILE_PANE_PX;
  const focusKey = narrow ? focusIds.join(",") : "";
  // The first framing must not animate — the graph would swoop in from the
  // identity transform on every page load.
  const framed = useRef(false);

  const graphBounds = useMemo(() => dataMapGraphBounds(manifest), [manifest]);
  const boxById = useMemo(
    () => new Map<string, DataMapBox>(manifest.nodes.map((n) => [n.id, n])),
    [manifest.nodes],
  );

  // `focusKey` is the DEPENDENCY — a stable string beats an array rebuilt on
  // every render — while the ids are read from the array itself, so an id
  // containing the delimiter cannot silently drop a node from the frame.
  const focusList = useMemo(
    () => (narrow ? focusIds : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by focusKey
    [focusKey],
  );

  useEffect(() => {
    const focusBoxes = focusList
      .map((id) => boxById.get(id))
      .filter((b): b is DataMapBox => !!b);
    const focus = focusBoxes.length ? dataMapBounds(focusBoxes) : null;
    const bounds = focus ?? graphBounds;
    if (!bounds) return;
    const viewport = viewportForBounds(bounds, width, height, {
      padding: focus ? FOCUS_PADDING : FIT_PADDING,
      minZoom: PANE_MIN_ZOOM,
      maxZoom: focus ? FOCUS_MAX_ZOOM : FIT_MAX_ZOOM,
    });
    if (!viewport) {
      // CameraDirector is now the ONLY thing that can frame this graph, so its
      // early returns are the whole failure surface: an unmeasured pane leaves
      // the identity transform, i.e. bit-for-bit the bug this replaced.
      if (import.meta.env.DEV && !framed.current)
        console.warn(
          `[data map] pane unmeasured (${width}x${height}) — graph unframed`,
        );
      return;
    }
    const duration = framed.current ? (focus ? 500 : 300) : 0;
    framed.current = true;
    void setViewport(viewport, { duration });
  }, [setViewport, width, height, focusList, graphBounds, boxById, frameNonce]);
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
  fitLabel,
  onSelect,
}) => {
  const [hoverId, setHoverId] = useState<string | null>(null);
  // The fit control is ours (see the Controls block below).
  const [frameNonce, setFrameNonce] = useState(0);
  const reframe = useCallback(() => setFrameNonce((n) => n + 1), []);
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

  // ONE hop, deliberately not a closure: lateral links are a different
  // relationship from lineage, and walking them transitively would light up
  // roughly half the graph on any selection.
  const linkNeighbours = useMemo(
    () =>
      selectedId
        ? new Set(
            dataMapLinkNeighbours(manifest.links, selectedId).map((l) =>
              l.a === selectedId ? l.b : l.a,
            ),
          )
        : null,
    [manifest.links, selectedId],
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
          n.id === selectedId
            ? "selected"
            : closure?.has(n.id)
              ? "hot"
              : linkNeighbours?.has(n.id)
                ? "linked"
                : "dim";
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
    linkNeighbours,
    viewIds,
    freshness,
    freshLabel,
    kindLabels,
    lens,
    onSelect,
    now,
  ]);

  // Lateral links, drawn from a SEPARATE array and never part of the lineage
  // edge list (§1.1: 15 of them in the ELK graph split the dataset tier into
  // five columns). Hidden unless the `links` lens is on or a node is selected —
  // 18 extra edges over a portrait graph by default would make the map less
  // legible, which inverts the point.
  const lateralEdges: Edge[] = useMemo(() => {
    const show = lens === "links" || !!selectedId;
    if (!show) return [];
    const posY = new Map(manifest.nodes.map((n) => [n.id, n.y]));
    return manifest.links
      .filter((l) => !selectedId || l.a === selectedId || l.b === selectedId)
      .map((l) => {
        // Pick top vs bottom by sign of Δy so the edge leaves toward its
        // partner instead of wrapping around the card.
        const aAbove = (posY.get(l.a) ?? 0) <= (posY.get(l.b) ?? 0);
        const color =
          l.kind === "boundary"
            ? "hsl(var(--muted-foreground))"
            : (l.key && DATA_MAP_KEY_COLOR[l.key]) ||
              "hsl(var(--muted-foreground))";
        return {
          id: `lat:${l.id}`,
          source: l.a,
          target: l.b,
          sourceHandle: aAbove ? "lat-b" : "lat-t",
          targetHandle: aAbove ? "lat-t" : "lat-b",
          type: "straight",
          // A boundary link is NOT a join: dashed and grey, with no key colour,
          // so it cannot be read as "these two share a key".
          style: {
            stroke: color,
            strokeWidth: selectedId ? 1.8 : 1.2,
            strokeDasharray: l.kind === "boundary" ? "2 4" : "5 4",
            opacity: selectedId ? 0.85 : 0.45,
          },
          label:
            selectedId && l.kind === "join" && typeof l.overlap === "number"
              ? formatCount(l.overlap, lang === "bg" ? "bg-BG" : "en-GB", 0)
              : undefined,
          labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
          labelBgStyle: { fill: "hsl(var(--background))", fillOpacity: 0.85 },
          focusable: false,
          selectable: false,
        } satisfies Edge;
      });
  }, [manifest.links, manifest.nodes, lens, selectedId, lang]);

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
  // Lineage first so the lateral dashes draw over it rather than under.
  const allEdges = useMemo(
    () => [...edges, ...lateralEdges],
    [edges, lateralEdges],
  );

  // connectionMode: Loose, not the default Strict. Under Strict,
  // getEdgePosition resolves targetHandle against handleBounds.target ONLY, so
  // an edge aimed at a type="source" handle returns null and paints nothing —
  // with no console warning at all. Measured before that prop existed: 182
  // lineage edges rendered and 0 lateral ones, while 72 lat-* handles sat in
  // the DOM. The lateral handles are sources because a link is undirected.
  return (
    <div className="absolute inset-0">
      <ReactFlow
        connectionMode={ConnectionMode.Loose}
        className="datamap-flow"
        nodes={nodes}
        edges={allEdges}
        nodeTypes={nodeTypes}
        minZoom={PANE_MIN_ZOOM}
        maxZoom={PANE_MAX_ZOOM}
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
        {/* React Flow's own fit button cannot frame this graph (see
            CameraDirector), and `onFitView` does NOT replace it: Controls runs
            `fitView(fitViewOptions)` first and calls the handler after. Since
            fitView starts working once the nodes have painted, wiring it there
            framed TWICE per click — an instant snap to upstream's padding 0.1 /
            maxZoom 2, then our 300ms animation to 0.03 / 1.15 (measured at a
            1008px pane: a 6.8% zoom pop and a 109px jump). So hide it and own
            it. The label is explicit because a bare ControlButton would ship an
            unlabelled icon, where React Flow's own supplies one. */}
        <Controls
          showInteractive={false}
          showFitView={false}
          position="bottom-right"
        >
          <ControlButton
            onClick={reframe}
            title={fitLabel}
            aria-label={fitLabel}
          >
            <Maximize aria-hidden />
          </ControlButton>
        </Controls>
        <CameraDirector
          manifest={manifest}
          focusIds={closure ? [...closure] : []}
          frameNonce={frameNonce}
        />
      </ReactFlow>
    </div>
  );
};

export const DataMapCanvas: FC<Props> = (props) => (
  <ReactFlowProvider>
    <InnerCanvas {...props} />
  </ReactFlowProvider>
);
