import { useMemo } from "react";
import {
  sankey,
  sankeyLeft,
  sankeyLinkHorizontal,
  SankeyExtraProperties,
  SankeyGraph,
  SankeyLink,
  SankeyNode,
} from "d3-sankey";
import { useTranslation } from "react-i18next";
import { VoteFlowMatrix } from "@/data/voteFlows/voteFlowTypes";
import { VoteFlowHover } from "./VoteFlowTooltip";

type NodeDatum = SankeyExtraProperties & {
  id: string;
  side: "from" | "to";
  label: string;
  labelEn: string;
  color: string;
  votes: number;
  pseudo?: boolean;
};

type LinkDatum = SankeyExtraProperties & {
  votes: number;
};

const NODE_WIDTH = 14;
const NODE_PADDING = 10;

export type SankeyClickInfo = {
  id: string;
  side: "from" | "to";
  /** y centre of the clicked node within the SVG coordinate system, as a
   * fraction of the SVG height. The parent uses this to position the
   * pinned overlay opposite the node. */
  yFrac: number;
};

export const VoteFlowSankey = ({
  matrix,
  width,
  height,
  hoveredId,
  pinnedId,
  onHover,
  onClickNode,
}: {
  matrix: VoteFlowMatrix;
  width: number;
  height: number;
  /** Currently hovered node id (drives the dim/highlight policy). */
  hoveredId?: string | null;
  /** Currently pinned node id (also drives highlight; survives mouse leave). */
  pinnedId?: string | null;
  /** Hover/move events — the parent renders the tooltip. Null = no hover. */
  onHover?: (sel: VoteFlowHover | null) => void;
  /** Click on a node body — parent pins the overlay. */
  onClickNode?: (info: SankeyClickInfo) => void;
}) => {
  const { i18n } = useTranslation();
  const isEn = i18n.language === "en";

  const graph = useMemo(() => {
    const nodes: NodeDatum[] = [
      ...matrix.fromNodes.map((n) => ({ ...n, side: "from" as const })),
      ...matrix.toNodes.map((n) => ({ ...n, side: "to" as const })),
    ];
    const idToIdx = new Map<string, number>();
    nodes.forEach((n, i) => idToIdx.set(`${n.side}:${n.id}`, i));
    const links = matrix.flows
      .map((f) => {
        const sIdx = idToIdx.get(`from:${f.from}`);
        const tIdx = idToIdx.get(`to:${f.to}`);
        if (sIdx === undefined || tIdx === undefined) return null;
        return { source: sIdx, target: tIdx, value: f.votes, votes: f.votes };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return { nodes, links };
  }, [matrix]);

  const layout = useMemo(() => {
    if (width <= 0 || height <= 0 || graph.nodes.length === 0) return null;
    const generator = sankey<NodeDatum, LinkDatum>()
      .nodeWidth(NODE_WIDTH)
      .nodePadding(NODE_PADDING)
      .nodeAlign(sankeyLeft)
      .extent([
        [1, 1],
        [width - 1, height - 1],
      ]);
    // d3-sankey mutates the input — clone first.
    const cloned: SankeyGraph<NodeDatum, LinkDatum> = {
      nodes: graph.nodes.map((n) => ({ ...n })),
      links: graph.links.map((l) => ({ ...l })),
    };
    return generator(cloned);
  }, [graph, width, height]);

  if (!layout) return null;

  const focusId = pinnedId ?? hoveredId ?? null;

  // Highlight policy: when a node is focused (hovered or pinned), dim every
  // link not touching it; otherwise default opacity. Hovered link gets its
  // own brighter treatment via `hoveredLink` below.
  const isLinkHighlightedByNode = (
    link: SankeyLink<NodeDatum, LinkDatum>,
  ): boolean | null => {
    if (focusId) {
      const s = link.source as SankeyNode<NodeDatum, LinkDatum>;
      const t = link.target as SankeyNode<NodeDatum, LinkDatum>;
      return s.id === focusId || t.id === focusId;
    }
    return null;
  };

  const linkPath = sankeyLinkHorizontal<NodeDatum, LinkDatum>();

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label="Vote flow Sankey"
      onMouseLeave={() => onHover?.(null)}
    >
      <defs>
        {layout.links.map((link, i) => {
          const s = link.source as SankeyNode<NodeDatum, LinkDatum>;
          const t = link.target as SankeyNode<NodeDatum, LinkDatum>;
          return (
            <linearGradient
              key={`grad-${i}`}
              id={`vfgrad-${i}`}
              gradientUnits="userSpaceOnUse"
              x1={s.x1 ?? 0}
              x2={t.x0 ?? 0}
            >
              <stop offset="0%" stopColor={s.color} />
              <stop offset="100%" stopColor={t.color} />
            </linearGradient>
          );
        })}
      </defs>
      <g>
        {layout.links.map((link, i) => {
          const highlighted = isLinkHighlightedByNode(link);
          const opacity =
            highlighted === null ? 0.45 : highlighted ? 0.75 : 0.08;
          const s = link.source as NodeDatum & SankeyNode<NodeDatum, LinkDatum>;
          const t = link.target as NodeDatum & SankeyNode<NodeDatum, LinkDatum>;
          return (
            <path
              key={`link-${i}`}
              d={linkPath(link) ?? ""}
              fill="none"
              stroke={`url(#vfgrad-${i})`}
              strokeOpacity={opacity}
              strokeWidth={Math.max(1, link.width ?? 1)}
              onMouseEnter={(e) =>
                onHover?.({
                  kind: "link",
                  from: s.id,
                  to: t.id,
                  votes: link.votes ?? 0,
                  sourceVotes: s.votes,
                  clientX: e.clientX,
                  clientY: e.clientY,
                })
              }
              onMouseMove={(e) =>
                onHover?.({
                  kind: "link",
                  from: s.id,
                  to: t.id,
                  votes: link.votes ?? 0,
                  sourceVotes: s.votes,
                  clientX: e.clientX,
                  clientY: e.clientY,
                })
              }
              style={{ cursor: "pointer", transition: "stroke-opacity 120ms" }}
            />
          );
        })}
      </g>
      <g>
        {layout.nodes.map((node) => {
          const isFocus = focusId === node.id;
          const opacity = focusId && !isFocus ? 0.4 : 1;
          const labelText = isEn ? node.labelEn : node.label;
          const yMid = ((node.y0 ?? 0) + (node.y1 ?? 0)) / 2;
          const yFrac = height > 0 ? yMid / height : 0.5;
          return (
            <g
              key={`node-${node.side}-${node.id}`}
              onMouseEnter={(e) =>
                onHover?.({
                  kind: "node",
                  id: node.id,
                  side: node.side,
                  clientX: e.clientX,
                  clientY: e.clientY,
                })
              }
              onMouseMove={(e) =>
                onHover?.({
                  kind: "node",
                  id: node.id,
                  side: node.side,
                  clientX: e.clientX,
                  clientY: e.clientY,
                })
              }
              onClick={(e) => {
                e.stopPropagation();
                onClickNode?.({ id: node.id, side: node.side, yFrac });
              }}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={node.x0}
                y={node.y0}
                width={(node.x1 ?? 0) - (node.x0 ?? 0)}
                height={Math.max(1, (node.y1 ?? 0) - (node.y0 ?? 0))}
                fill={node.color}
                fillOpacity={opacity}
                stroke={
                  pinnedId === node.id
                    ? "#111"
                    : hoveredId === node.id
                      ? "#111"
                      : "transparent"
                }
                strokeWidth={pinnedId === node.id ? 2 : 1}
              />
              <text
                x={
                  node.side === "from" ? (node.x1 ?? 0) + 6 : (node.x0 ?? 0) - 6
                }
                y={yMid}
                dy="0.35em"
                textAnchor={node.side === "from" ? "start" : "end"}
                fontSize={11}
                fillOpacity={opacity}
                className="fill-foreground"
                style={{ pointerEvents: "none" }}
              >
                {labelText}
              </text>
            </g>
          );
        })}
      </g>
      <style>
        {`@media (prefers-reduced-motion: reduce) { path { transition: none !important; } }`}
      </style>
    </svg>
  );
};
