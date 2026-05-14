// 3-column sankey: awarder → contractor → MP. The shape is precomputed by
// scripts/procurement/derived.ts; the SVG just lays it out via d3-sankey.
//
// Forked from src/screens/components/voteFlow/VoteFlowSankey.tsx (2-column,
// from→to). The procurement graph has natural depth — awarder→contractor is
// depth 0→1, contractor→mp is depth 1→2 — so d3-sankey produces the three
// columns automatically without explicit column hints.

import { FC, useMemo } from "react";
import {
  sankey,
  sankeyJustify,
  sankeyLinkHorizontal,
  SankeyExtraProperties,
  SankeyGraph,
  SankeyLink,
  SankeyNode,
} from "d3-sankey";
import type {
  ProcurementFlowLink,
  ProcurementFlowNode,
  ProcurementFlowNodeType,
} from "@/data/procurement/useProcurementFlow";
import { formatEur } from "@/lib/currency";

type NodeDatum = SankeyExtraProperties & ProcurementFlowNode;
// d3-sankey requires a numeric `value` field to size the ribbons — it holds
// the link's euro total (see scripts/procurement/derived.ts).
type LinkDatum = SankeyExtraProperties & {
  value: number;
};

const NODE_WIDTH = 14;
const NODE_PADDING = 8;

// Stable colors per node type. Same families used elsewhere in the codebase
// (amber = MP, slate = awarder, terracotta = contractor) so the visual
// language stays consistent with /connections.
const TYPE_COLOR: Record<ProcurementFlowNodeType, string> = {
  awarder: "#475569",
  contractor: "#d97706",
  mp: "#2563eb",
};

const formatLinkValue = (l: LinkDatum): string => formatEur(l.value);

export interface FlowHover {
  kind: "link" | "node";
  // For node hover.
  nodeId?: string;
  nodeLabel?: string;
  nodeType?: ProcurementFlowNodeType;
  // For link hover.
  sourceLabel?: string;
  targetLabel?: string;
  valueEur?: number;
  clientX: number;
  clientY: number;
}

export const ProcurementFlowSankey: FC<{
  nodes: ProcurementFlowNode[];
  links: ProcurementFlowLink[];
  width: number;
  height: number;
  hoveredId?: string | null;
  onHover?: (h: FlowHover | null) => void;
}> = ({ nodes, links, width, height, hoveredId, onHover }) => {
  const graph = useMemo(() => {
    // Drop any link whose endpoints aren't in the node set (defensive — the
    // upstream build should always be consistent, but the sankey generator
    // crashes on orphan refs).
    const idToIdx = new Map<string, number>();
    nodes.forEach((n, i) => idToIdx.set(n.id, i));
    const sankeyLinks: Array<{
      source: number;
      target: number;
      value: number;
    }> = [];
    for (const l of links) {
      const s = idToIdx.get(l.source);
      const t = idToIdx.get(l.target);
      if (s === undefined || t === undefined) continue;
      // d3-sankey requires value > 0 to render the ribbon. Skip zero-value
      // links — they're noise from non-priced award notices.
      if (!(l.valueEur > 0)) continue;
      sankeyLinks.push({
        source: s,
        target: t,
        value: l.valueEur,
      });
    }
    return { nodes: nodes.map((n) => ({ ...n })), links: sankeyLinks };
  }, [nodes, links]);

  const layout = useMemo(() => {
    if (width <= 0 || height <= 0 || graph.nodes.length === 0) return null;
    const generator = sankey<NodeDatum, LinkDatum>()
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      // sankeyJustify produces evenly-spaced columns for 3+ depth graphs.
      // sankeyLeft would compress the middle column to the left.
      .nodeAlign(sankeyJustify)
      .extent([
        [1, 1],
        [width - 1, height - 1],
      ]);
    const cloned: SankeyGraph<NodeDatum, LinkDatum> = {
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.links.map((l) => ({ ...l })),
    };
    return generator(cloned);
  }, [graph, width, height]);

  if (!layout) return null;

  const linkPath = sankeyLinkHorizontal<NodeDatum, LinkDatum>();
  const focusId = hoveredId ?? null;

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label="MP-tied procurement money flow"
      onMouseLeave={() => onHover?.(null)}
    >
      <defs>
        {layout.links.map((link, i) => {
          const s = link.source as SankeyNode<NodeDatum, LinkDatum>;
          const t = link.target as SankeyNode<NodeDatum, LinkDatum>;
          return (
            <linearGradient
              key={`grad-${i}`}
              id={`pflow-grad-${i}`}
              gradientUnits="userSpaceOnUse"
              x1={s.x1 ?? 0}
              x2={t.x0 ?? 0}
            >
              <stop offset="0%" stopColor={TYPE_COLOR[s.type]} />
              <stop offset="100%" stopColor={TYPE_COLOR[t.type]} />
            </linearGradient>
          );
        })}
      </defs>
      <g>
        {layout.links.map((link, i) => {
          const s = link.source as SankeyNode<NodeDatum, LinkDatum>;
          const t = link.target as SankeyNode<NodeDatum, LinkDatum>;
          const touchesFocus =
            focusId && (s.id === focusId || t.id === focusId);
          const opacity = focusId ? (touchesFocus ? 0.75 : 0.08) : 0.45;
          return (
            <path
              key={`link-${i}`}
              d={linkPath(link as SankeyLink<NodeDatum, LinkDatum>) ?? ""}
              fill="none"
              stroke={`url(#pflow-grad-${i})`}
              strokeOpacity={opacity}
              strokeWidth={Math.max(1, link.width ?? 1)}
              onMouseEnter={(e) =>
                onHover?.({
                  kind: "link",
                  sourceLabel: s.label,
                  targetLabel: t.label,
                  valueEur: link.value,
                  clientX: e.clientX,
                  clientY: e.clientY,
                })
              }
              onMouseMove={(e) =>
                onHover?.({
                  kind: "link",
                  sourceLabel: s.label,
                  targetLabel: t.label,
                  valueEur: link.value,
                  clientX: e.clientX,
                  clientY: e.clientY,
                })
              }
              style={{ cursor: "pointer", transition: "stroke-opacity 120ms" }}
            >
              <title>{`${s.label} → ${t.label}: ${formatLinkValue(link as LinkDatum)}`}</title>
            </path>
          );
        })}
      </g>
      <g>
        {layout.nodes.map((node) => {
          const isFocus = focusId === node.id;
          const opacity = focusId && !isFocus ? 0.35 : 1;
          const y0 = node.y0 ?? 0;
          const y1 = node.y1 ?? 0;
          const yMid = (y0 + y1) / 2;
          const nodeHeight = Math.max(1, y1 - y0);
          // Right-justify left/middle column labels on the right side of the
          // rect; right-column labels on the left. Determined by x position
          // rather than node.type so any future column changes still work.
          const isRightmost = (node.x0 ?? 0) > width / 2;
          // Skip labels for nodes too thin to be readable — they'd collide
          // with their neighbours. The hover-title on the rect still works,
          // and the focused node always shows its label even when small.
          const minHeightForLabel = 11;
          const showLabel = nodeHeight >= minHeightForLabel || isFocus;
          return (
            <g
              key={`node-${node.id}`}
              onMouseEnter={(e) =>
                onHover?.({
                  kind: "node",
                  nodeId: node.id,
                  nodeLabel: node.label,
                  nodeType: node.type,
                  clientX: e.clientX,
                  clientY: e.clientY,
                })
              }
              onMouseMove={(e) =>
                onHover?.({
                  kind: "node",
                  nodeId: node.id,
                  nodeLabel: node.label,
                  nodeType: node.type,
                  clientX: e.clientX,
                  clientY: e.clientY,
                })
              }
              style={{ cursor: "pointer" }}
            >
              <rect
                x={node.x0}
                y={node.y0}
                width={(node.x1 ?? 0) - (node.x0 ?? 0)}
                height={nodeHeight}
                fill={TYPE_COLOR[node.type]}
                fillOpacity={opacity}
              >
                <title>{node.label}</title>
              </rect>
              {showLabel ? (
                <text
                  x={isRightmost ? (node.x0 ?? 0) - 6 : (node.x1 ?? 0) + 6}
                  y={yMid}
                  dy="0.35em"
                  textAnchor={isRightmost ? "end" : "start"}
                  fontSize={11}
                  fillOpacity={opacity}
                  className="fill-foreground"
                  style={{ pointerEvents: "none" }}
                >
                  {truncate(node.label, 36)}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
  );
};

const truncate = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;
