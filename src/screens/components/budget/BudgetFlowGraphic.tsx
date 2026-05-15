// The budget-flow графика. One SVG, three zones:
//   left  — revenue Sankey (mirrored: leaves → group → Revenue total at the
//           right edge of the zone, so flow visually enters the bridge)
//   middle — the balance bridge: revenue and spending columns drawn at the
//           same full height, deficit/surplus rendered as a hatched wedge
//           (the usafacts metaphor — borrowing closes the gap)
//   right  — spending Sankey (normal: Spending total at left edge → group →
//           leaves)
//
// d3-sankey lays out each side independently; the left side is mirrored on x
// after layout. Hover state is shared across both sides and the bridge so the
// user can trace a flow end-to-end.

import { FC, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  sankey,
  sankeyLeft,
  sankeyRight,
  sankeyLinkHorizontal,
  SankeyExtraProperties,
  SankeyGraph,
  SankeyLink,
  SankeyNode,
} from "d3-sankey";
import { easeCubicInOut } from "d3";
import { useTranslation } from "react-i18next";
import { formatEur } from "@/lib/currency";
import { useTooltip } from "@/ux/useTooltip";
import type { BudgetFlowModel, FlowGraph, FlowNode } from "./budgetFlowModel";

type NodeDatum = SankeyExtraProperties & FlowNode;
type LinkDatum = SankeyExtraProperties & { value: number };

const NODE_WIDTH = 14;
// The two TOTAL nodes sit at the inner edges of each Sankey and act as the
// balance bridge themselves. Render them WIDE — they carry the embedded
// "Revenue / Spending / Deficit / Surplus · €value" labels (rotated 90°),
// matching the USAFacts balance-bridge metaphor where the two totals are
// the focal columns of the chart.
const TOTAL_NODE_WIDTH = 68;
// Tight padding so totals from both sides occupy nearly the full SVG height —
// padding between siblings eats vertical space, and the two sides have
// different node counts, so a generous padding leaves the two totals at
// noticeably different heights.
const NODE_PADDING = 2;
// Gap between the two side Sankeys. The wider total nodes extend into this
// gap from both sides — TOTAL_NODE_WIDTH-NODE_WIDTH per side — leaving a
// small visual breathing space in the middle.
const SIDES_GAP = 120;
const TOTAL_INWARD = TOTAL_NODE_WIDTH - NODE_WIDTH;
// Outer label gutter. Leaves sit on the outer edges of each side; their
// labels extend OUTWARD past the sankey extent. The spending side now has a
// depth-2 outer column (subcategories like "Социалноосигурителни фондове")
// with longer labels, so the gutter is generous on both sides for symmetry.
const LABEL_MARGIN = 220;
const LABEL_MAX_CHARS = 30;
const HATCH_PATTERN_ID = "budget-flow-hatch";

const COLOR_REVENUE = "#10b981"; // emerald-500
const COLOR_SPENDING = "#f43f5e"; // rose-500
const COLOR_EU = "#2563eb"; // blue-600
const COLOR_DEFICIT = "#fb7185"; // rose-400
const COLOR_SURPLUS = "#34d399"; // emerald-400

const colorFor = (node: FlowNode): string => {
  if (node.id === "spending-section-III") return COLOR_EU;
  return node.side === "revenue" ? COLOR_REVENUE : COLOR_SPENDING;
};

// Compact Euro formatter for the embedded wall captions only: "€5.46 B",
// "€397 M", "€80 K". Wall captions are rotated 90° so the available width is
// the wall's height; even at 480 px tall, a full formatEur() like
// "€1 918 355 713" plus a label like "Бюджетен дефицит" doesn't fit when the
// hatched portion shrinks below ~150 px. The full euro figure remains in the
// tooltip on hover.
const compactEur = (value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}€${(abs / 1e9).toFixed(2)} B`;
  if (abs >= 1e6) return `${sign}€${Math.round(abs / 1e6)} M`;
  if (abs >= 1e3) return `${sign}€${Math.round(abs / 1e3)} K`;
  return `${sign}€${Math.round(abs)}`;
};

// Render one of the two total walls (revenue or spending). The wall is split
// vertically into a SOLID portion (top, sized to the side's real value) and,
// if this side absorbs the deficit/surplus padding, a HATCHED portion below
// (sized to the balance gap). Each portion carries an embedded "Label · €N"
// caption rotated 90° so it reads from bottom to top inside the column.
const renderTotalWall = ({
  node,
  renderX0,
  renderX1,
  renderWidth,
  y0,
  y1,
  baseOpacity,
  balance,
  deficitLabel,
  surplusLabel,
}: {
  node: FlowNode;
  renderX0: number;
  renderX1: number;
  renderWidth: number;
  y0: number;
  y1: number;
  baseOpacity: number;
  balance: BudgetFlowModel["balance"];
  deficitLabel: string;
  surplusLabel: string;
}): React.ReactNode => {
  const wallHeight = y1 - y0;
  const isDeficitWall = node.side === "revenue" && balance.isDeficit;
  const isSurplusWall =
    node.side === "spending" && !balance.isDeficit && balance.balanceEur > 0;
  const showHatch = isDeficitWall || isSurplusWall;
  const solidEur =
    node.side === "revenue" ? balance.revenueEur : balance.spendingEur;
  const totalForRatio = node.valueEur > 0 ? node.valueEur : 1;
  const solidRatio = Math.max(0, Math.min(1, solidEur / totalForRatio));
  const solidHeight = wallHeight * solidRatio;
  const solidY0 = y0;
  const solidY1 = y0 + solidHeight;
  const hatchY0 = solidY1;
  const hatchY1 = y1;
  const hatchHeight = Math.max(0, hatchY1 - hatchY0);
  const phantomEur = Math.abs(balance.balanceEur);
  const cx = (renderX0 + renderX1) / 2;
  const solidColor = colorFor(node);
  const balanceLabel = balance.isDeficit ? deficitLabel : surplusLabel;
  const balanceFill = balance.isDeficit
    ? "#9f1239" // rose-800 — sits readably over the hatched rose-400 stripes
    : "#065f46"; // emerald-800 — same idea on the surplus side
  // Minimum height (in px) at which a vertical caption fits with margin.
  const MIN_LABEL_H = 26;
  const renderCaption = (
    sy0: number,
    sy1: number,
    label: string,
    valueEur: number,
    fill: string,
  ): React.ReactNode => {
    const cy = (sy0 + sy1) / 2;
    // Rotated text's available width == the portion's vertical height. Pick
    // a font size that keeps "{label} · €X.XX B" inside the portion: 13 px
    // for tall portions, scaling down for short ones (deficit/surplus
    // segments are often only ~100-150 px tall).
    const portionH = sy1 - sy0;
    const fontSize = portionH < 130 ? 11 : 13;
    return (
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={fontSize}
        fontWeight={600}
        fill={fill}
        transform={`rotate(-90 ${cx} ${cy})`}
        style={{ pointerEvents: "none" }}
      >
        {label} · {compactEur(valueEur)}
      </text>
    );
  };
  return (
    <>
      {/* Solid portion — the side's real value (revenue or spending). */}
      <rect
        x={renderX0}
        y={solidY0}
        width={renderWidth}
        height={solidHeight}
        fill={solidColor}
        fillOpacity={baseOpacity}
      />
      {solidHeight >= MIN_LABEL_H
        ? renderCaption(solidY0, solidY1, node.label, solidEur, "white")
        : null}
      {/* Hatched portion — the deficit (on revenue) or surplus (on spending)
          that closes the gap between the two sides. Rendered as a hatched
          OVERLAY on top of a faint base fill so the stripes read cleanly
          against the chart background. */}
      {showHatch && hatchHeight > 0 ? (
        <>
          <rect
            x={renderX0}
            y={hatchY0}
            width={renderWidth}
            height={hatchHeight}
            fill={solidColor}
            fillOpacity={baseOpacity * 0.18}
          />
          <rect
            x={renderX0}
            y={hatchY0}
            width={renderWidth}
            height={hatchHeight}
            fill={`url(#${HATCH_PATTERN_ID})`}
            fillOpacity={baseOpacity}
          />
          {hatchHeight >= MIN_LABEL_H
            ? renderCaption(
                hatchY0,
                hatchY1,
                balanceLabel,
                phantomEur,
                balanceFill,
              )
            : null}
        </>
      ) : null}
    </>
  );
};

interface SankeyLayoutResult {
  nodes: Array<SankeyNode<NodeDatum, LinkDatum>>;
  links: Array<SankeyLink<NodeDatum, LinkDatum>>;
}

const layoutGraph = (
  graph: FlowGraph,
  width: number,
  height: number,
  align: "left" | "right",
): SankeyLayoutResult | null => {
  if (width <= 0 || height <= 0 || graph.nodes.length === 0) return null;
  const idToIdx = new Map<string, number>();
  graph.nodes.forEach((n, i) => idToIdx.set(n.id, i));
  const sankeyLinks: Array<{
    source: number;
    target: number;
    value: number;
  }> = [];
  for (const l of graph.links) {
    const s = idToIdx.get(l.source);
    const t = idToIdx.get(l.target);
    if (s === undefined || t === undefined) continue;
    if (!(l.valueEur > 0)) continue;
    sankeyLinks.push({ source: s, target: t, value: l.valueEur });
  }
  const generator = sankey<NodeDatum, LinkDatum>()
    .nodeWidth(NODE_WIDTH)
    .nodePadding(NODE_PADDING)
    // sankeyRight pushes the totals to the right edge (good for the spending
    // side — total then groups then leaves left-to-right). sankeyLeft does
    // the opposite for the revenue side, which we'll then mirror.
    .nodeAlign(align === "right" ? sankeyRight : sankeyLeft)
    // null = preserve input order within each column. The default heuristic
    // (minimum-overlap) interleaves outer leaves whose targets are different
    // depth-0 groups — a Трансфери child can end up between two Разходи
    // children, creating visual crossings. The model emits leaves grouped by
    // their depth-0 parent (all Разходи children, then all Трансфери children,
    // then EU), so input order is exactly the grouping we want vertically.
    .nodeSort(null)
    .linkSort(null)
    .extent([
      [1, 1],
      [width - 1, height - 1],
    ]);
  const cloned: SankeyGraph<NodeDatum, LinkDatum> = {
    nodes: graph.nodes.map((n) => ({ ...n })),
    links: sankeyLinks.map((l) => ({ ...l })),
  };
  const result = generator(cloned);

  // Post-layout: align outer-column leaves with their depth-0 parent's y
  // band. d3-sankey distributes free vertical space as padding between
  // siblings *per column*, so depth-0 (3 nodes → 2 gaps of ~13-18 px) and
  // the outer column (~16 leaves → ~1 px between siblings) end up with
  // wildly different gap sizes. Leaves from different parents get jammed
  // against each other at the boundary even though their parent blocks have
  // a visible gap between them — and a leaf can even spill above/below its
  // parent's block. We re-stack each parent's children tightly inside the
  // parent's y range and update the leaf→parent links so they render as
  // near-horizontal stripes.
  const parentToChildren = new Map<
    string,
    Array<SankeyNode<NodeDatum, LinkDatum>>
  >();
  for (const node of result.nodes) {
    const outgoing = result.links.filter(
      (l) => (l.source as SankeyNode<NodeDatum, LinkDatum>).id === node.id,
    );
    if (outgoing.length !== 1) continue;
    const target = outgoing[0].target as SankeyNode<NodeDatum, LinkDatum>;
    if (target.type !== "group") continue;
    const list = parentToChildren.get(target.id) ?? [];
    list.push(node);
    parentToChildren.set(target.id, list);
  }
  // Gap between sibling leaves inside the same parent (in px). USAFacts
  // separates every child block with a thin gap so the eye can resolve each
  // value as a distinct rectangle. Children are scaled to fit (parent.height
  // − total_gap_height) so the stack still aligns with the parent's y range.
  const CHILD_GAP = 4;
  for (const [parentId, children] of parentToChildren) {
    const parent = result.nodes.find((n) => n.id === parentId);
    if (!parent) continue;
    const parentY0 = parent.y0 ?? 0;
    const parentY1 = parent.y1 ?? 0;
    const parentH = parentY1 - parentY0;
    // Preserve d3-sankey's input-order placement (linkSort/nodeSort are
    // null so this matches the model's parent-grouped emission order).
    children.sort((a, b) => (a.y0 ?? 0) - (b.y0 ?? 0));
    const totalChildH = children.reduce(
      (sum, c) => sum + Math.max(0, (c.y1 ?? 0) - (c.y0 ?? 0)),
      0,
    );
    // Reserve CHILD_GAP between each pair of siblings. If the parent is too
    // short for that many gaps, fall back to no gap (children stack tightly).
    const totalGapH = Math.max(0, children.length - 1) * CHILD_GAP;
    const usableH = Math.max(1, parentH - totalGapH);
    const scale = totalChildH > 0 && usableH > 0 ? usableH / totalChildH : 1;
    let cursor = parentY0;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const origH = Math.max(0, (child.y1 ?? 0) - (child.y0 ?? 0));
      const newH = origH * scale;
      child.y0 = cursor;
      child.y1 = cursor + newH;
      cursor += newH;
      if (i < children.length - 1) cursor += CHILD_GAP;
      const link = result.links.find(
        (l) => (l.source as SankeyNode<NodeDatum, LinkDatum>).id === child.id,
      );
      if (link) {
        link.y0 = (child.y0 + child.y1) / 2;
        link.width = newH;
      }
    }
    // Recompute each link's target-side y position (its center within the
    // parent's incoming stack). Target stack has NO gap — children's link
    // widths still pack tightly within parent's height — so the link curves
    // from the gapped outer leaf to the tightly-packed parent slice.
    let incoming = parentY0;
    for (const child of children) {
      const newH = (child.y1 ?? 0) - (child.y0 ?? 0);
      const link = result.links.find(
        (l) => (l.source as SankeyNode<NodeDatum, LinkDatum>).id === child.id,
      );
      if (link) link.y1 = incoming + newH / 2;
      incoming += newH;
    }
  }
  return result;
};

// Rescale & translate each side's nodes and links so both total walls have
// the same pixel height AND occupy the same y range. d3-sankey runs per-side,
// and the side with more leaves (spending) has a smaller value-to-pixel scale
// because its outer column needs more space for padding between siblings.
// Without this, the two walls land at different heights even though they
// represent the same euro total (the deficit phantom equalises the values).
const alignSideWalls = (
  left: SankeyLayoutResult,
  right: SankeyLayoutResult,
): void => {
  const leftWall = left.nodes.find((n) => n.type === "total");
  const rightWall = right.nodes.find((n) => n.type === "total");
  if (!leftWall || !rightWall) return;
  const leftH = (leftWall.y1 ?? 0) - (leftWall.y0 ?? 0);
  const rightH = (rightWall.y1 ?? 0) - (rightWall.y0 ?? 0);
  // Use the shorter wall as the target so neither side overflows its column.
  const targetH = Math.min(leftH, rightH);
  // Use the lower y0 (the wall that starts furthest from the top) so both
  // walls top-align at the same y after the rescale.
  const targetY0 = Math.max(leftWall.y0 ?? 0, rightWall.y0 ?? 0);
  const apply = (
    layout: SankeyLayoutResult,
    wall: SankeyNode<NodeDatum, LinkDatum>,
  ): void => {
    const wallH = (wall.y1 ?? 0) - (wall.y0 ?? 0);
    if (wallH <= 0) return;
    const scale = targetH / wallH;
    const translate = targetY0 - (wall.y0 ?? 0) * scale;
    for (const n of layout.nodes) {
      n.y0 = (n.y0 ?? 0) * scale + translate;
      n.y1 = (n.y1 ?? 0) * scale + translate;
    }
    for (const l of layout.links) {
      l.y0 = (l.y0 ?? 0) * scale + translate;
      l.y1 = (l.y1 ?? 0) * scale + translate;
      l.width = (l.width ?? 0) * scale;
    }
  };
  apply(left, leftWall);
  apply(right, rightWall);
};

// Mirror x-coordinates of all nodes/links inside a layout so the flow visually
// runs the other direction. After mirroring, leaves appear on the LEFT edge
// of the box and the total appears on the RIGHT (against the bridge).
const mirrorX = (
  layout: SankeyLayoutResult,
  width: number,
): SankeyLayoutResult => ({
  nodes: layout.nodes.map((n) => ({
    ...n,
    x0: width - (n.x1 ?? 0),
    x1: width - (n.x0 ?? 0),
  })),
  links: layout.links,
});

interface FocusState {
  id: string | null;
  side: "revenue" | "spending" | "bridge" | null;
}

interface AnimatedLayouts {
  left: SankeyLayoutResult;
  right: SankeyLayoutResult;
  bridge: { revenueEur: number; spendingEur: number; balanceEur: number };
}

const ANIM_DURATION_MS = 500;

// Cross-fade-by-id interpolation: rects whose ids exist in BOTH layouts tween
// position+size linearly; rects only in `from` fade to opacity 0 (kept at
// their last position); rects only in `to` fade in from opacity 0 (placed at
// their final position immediately). Same for links keyed on source/target id.
const interpolateLayouts = (
  from: AnimatedLayouts,
  to: AnimatedLayouts,
  t: number,
): AnimatedLayouts => {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const lerpSide = (
    a: SankeyLayoutResult,
    b: SankeyLayoutResult,
  ): SankeyLayoutResult => {
    const fromNodeMap = new Map<string, SankeyNode<NodeDatum, LinkDatum>>();
    a.nodes.forEach((n) => fromNodeMap.set(n.id, n));
    const nodes = b.nodes.map((target) => {
      const prev = fromNodeMap.get(target.id);
      if (!prev) return target; // appearing — snap to final
      return {
        ...target,
        x0: lerp(prev.x0 ?? 0, target.x0 ?? 0),
        x1: lerp(prev.x1 ?? 0, target.x1 ?? 0),
        y0: lerp(prev.y0 ?? 0, target.y0 ?? 0),
        y1: lerp(prev.y1 ?? 0, target.y1 ?? 0),
      };
    });
    // Re-attach link source/target as the interpolated node refs so the path
    // generator gets the right coordinates without a second match step.
    const nodeById = new Map<string, (typeof nodes)[number]>();
    nodes.forEach((n) => nodeById.set(n.id, n));
    const fromLinkMap = new Map<string, SankeyLink<NodeDatum, LinkDatum>>();
    a.links.forEach((l) => {
      const s = (l.source as SankeyNode<NodeDatum, LinkDatum>).id;
      const tgt = (l.target as SankeyNode<NodeDatum, LinkDatum>).id;
      fromLinkMap.set(`${s}→${tgt}`, l);
    });
    const links = b.links.map((target) => {
      const sId = (target.source as SankeyNode<NodeDatum, LinkDatum>).id;
      const tId = (target.target as SankeyNode<NodeDatum, LinkDatum>).id;
      const prev = fromLinkMap.get(`${sId}→${tId}`);
      const newSource = nodeById.get(sId) ?? target.source;
      const newTarget = nodeById.get(tId) ?? target.target;
      const interp: SankeyLink<NodeDatum, LinkDatum> = {
        ...target,
        source: newSource,
        target: newTarget,
        width: prev
          ? lerp(prev.width ?? 0, target.width ?? 0)
          : (target.width ?? 0) * t,
        y0: prev ? lerp(prev.y0 ?? 0, target.y0 ?? 0) : target.y0,
        y1: prev ? lerp(prev.y1 ?? 0, target.y1 ?? 0) : target.y1,
      };
      return interp;
    });
    return { nodes, links };
  };
  return {
    left: lerpSide(from.left, to.left),
    right: lerpSide(from.right, to.right),
    bridge: {
      revenueEur: lerp(from.bridge.revenueEur, to.bridge.revenueEur),
      spendingEur: lerp(from.bridge.spendingEur, to.bridge.spendingEur),
      balanceEur: lerp(from.bridge.balanceEur, to.bridge.balanceEur),
    },
  };
};

const FlowSvg: FC<{
  model: BudgetFlowModel;
  width: number;
  height: number;
}> = ({ model, width, height }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip();
  const [focus, setFocus] = useState<FocusState>({ id: null, side: null });

  const innerWidth = width - 2 * LABEL_MARGIN;
  const sideWidth = (innerWidth - SIDES_GAP) / 2;
  const leftX = LABEL_MARGIN;
  const rightX = leftX + sideWidth + SIDES_GAP;

  // Layouts. d3-sankey puts sources (leaves, only-outgoing) on the LEFT and
  // sinks (totals, only-incoming) on the RIGHT. That's already the right
  // orientation for the LEFT side of the screen — leaves outer, total inner
  // (against the bridge). The RIGHT side needs the opposite: total inner
  // (against the bridge from the right), leaves outer. Mirror it on x.
  const targetLayouts = useMemo<AnimatedLayouts | null>(() => {
    const left = layoutGraph(model.revenue, sideWidth, height, "right");
    const right = layoutGraph(model.spending, sideWidth, height, "right");
    if (!left || !right) return null;
    // Each side ran its own d3-sankey, which scales values to pixels using
    // that side's column constraints. Because the two sides have different
    // node counts (more leaves on spending), they end up with different
    // value-to-pixel scales and the two total walls have different pixel
    // heights — even though the totals represent the same euros (the deficit
    // phantom makes revenue+deficit == spending). Re-scale each side so both
    // walls land at the same y range, matching the USAFacts balance-bridge
    // metaphor: both columns are the same height; the hatched wedge inside
    // the revenue wall is the gap closed by financing.
    alignSideWalls(left, right);
    return {
      left,
      right: mirrorX(right, sideWidth),
      bridge: {
        revenueEur: model.balance.revenueEur,
        spendingEur: model.balance.spendingEur,
        balanceEur: model.balance.balanceEur,
      },
    };
  }, [model, sideWidth, height]);

  // Tween between layouts on FY/grain change. First render snaps; subsequent
  // changes animate over ANIM_DURATION_MS using cubic ease-in-out. Skipping
  // the animation entirely for size-only changes (resize) keeps the graphic
  // crisp when the user resizes the window.
  const [displayed, setDisplayed] = useState<AnimatedLayouts | null>(
    targetLayouts,
  );
  const previousRef = useRef<{
    layouts: AnimatedLayouts | null;
    modelKey: string;
  }>({
    layouts: targetLayouts,
    modelKey: `${model.fiscalYear}-${model.grain}`,
  });
  useEffect(() => {
    if (!targetLayouts) return;
    const modelKey = `${model.fiscalYear}-${model.grain}`;
    const sameModel = previousRef.current.modelKey === modelKey;
    if (sameModel || !previousRef.current.layouts) {
      setDisplayed(targetLayouts);
      previousRef.current = { layouts: targetLayouts, modelKey };
      return;
    }
    const from = previousRef.current.layouts;
    const to = targetLayouts;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ANIM_DURATION_MS);
      const eased = easeCubicInOut(t);
      setDisplayed(interpolateLayouts(from, to, eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else previousRef.current = { layouts: to, modelKey };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targetLayouts, model.fiscalYear, model.grain]);

  const layouts = displayed;

  // Highlight set: from the focus node, walk DOWNSTREAM (follow outgoing
  // links) and UPSTREAM (follow incoming links) — but never reverse direction
  // mid-walk. Otherwise the trace leaks across siblings via the shared total
  // (leaf → group → total → other groups → other leaves), highlighting the
  // entire side. The bright LINK paths (drawn at the focus's actual width)
  // visually show the contributing slice as it enters each broader rect; an
  // explicit slice overlay rect made the broader categories look like they
  // contained a duplicate copy of the focus.
  const highlightedIds = useMemo<Set<string>>(() => {
    if (!focus.id || !layouts) return new Set();
    const allLinks = [...layouts.left.links, ...layouts.right.links];
    const downstream = new Set<string>([focus.id]);
    const upstream = new Set<string>([focus.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const link of allLinks) {
        const sId = (link.source as SankeyNode<NodeDatum, LinkDatum>).id;
        const tId = (link.target as SankeyNode<NodeDatum, LinkDatum>).id;
        if (downstream.has(sId) && !downstream.has(tId)) {
          downstream.add(tId);
          grew = true;
        }
        if (upstream.has(tId) && !upstream.has(sId)) {
          upstream.add(sId);
          grew = true;
        }
      }
    }
    return new Set([...downstream, ...upstream]);
  }, [focus.id, layouts]);

  if (!layouts) return null;

  const linkPath = sankeyLinkHorizontal<NodeDatum, LinkDatum>();

  const renderSide = (
    layout: SankeyLayoutResult,
    side: "revenue" | "spending",
    offsetX: number,
  ): React.ReactNode => {
    const sidePrefix = side === "revenue" ? "rev" : "spend";
    return (
      <g transform={`translate(${offsetX}, 0)`} key={side}>
        <defs>
          {layout.links.map((link, i) => {
            const s = link.source as SankeyNode<NodeDatum, LinkDatum>;
            const tgt = link.target as SankeyNode<NodeDatum, LinkDatum>;
            return (
              <linearGradient
                key={`${sidePrefix}-grad-${i}`}
                id={`${sidePrefix}-grad-${i}`}
                gradientUnits="userSpaceOnUse"
                x1={Math.min(s.x1 ?? 0, tgt.x0 ?? 0)}
                x2={Math.max(s.x1 ?? 0, tgt.x0 ?? 0)}
              >
                <stop offset="0%" stopColor={colorFor(s)} />
                <stop offset="100%" stopColor={colorFor(tgt)} />
              </linearGradient>
            );
          })}
        </defs>
        <g>
          {layout.links.map((link, i) => {
            const s = link.source as SankeyNode<NodeDatum, LinkDatum>;
            const tgt = link.target as SankeyNode<NodeDatum, LinkDatum>;
            // Phantoms — neither layout phantoms (invisible source forcing
            // the EU group to depth-1) NOR balance phantoms (deficit/surplus
            // padding leaves) render their links. The deficit/surplus value
            // is now drawn as a hatched portion EMBEDDED inside the total
            // wall itself (see the total-node branch below), so the hatched
            // ribbon flowing from a phantom-leaf-on-the-side is gone.
            if (s.isPhantom || tgt.isPhantom) return null;
            // Two states under focus: the direct link of the focused node
            // (bright at its full natural width) vs everything else (uniformly
            // dim). Previously we drew on-traced-path links at 0.32 opacity
            // to show "where the focus's value goes," but those links carry
            // the PARENT's full value, not the focus's — so the wide
            // depth-0 → wall link rendered as a fat pink stripe that looked
            // like a duplicate of the focused leaf. The bright direct link
            // already enters the next node at exactly the focus's slice
            // position, which is enough to read the trace.
            const isFocusDirectLink =
              focus.id != null && (s.id === focus.id || tgt.id === focus.id);
            const opacity = !focus.id ? 0.45 : isFocusDirectLink ? 0.78 : 0.07;
            // Link tooltip — single line of "from → to · value" so it
            // doesn't read as a separate node label being introduced near
            // wherever the cursor lands.
            const tipContent = (
              <div className="flex items-baseline gap-2 max-w-[280px] text-xs">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="text-muted-foreground">→</span>
                <span className="text-muted-foreground">{tgt.label}</span>
                <span className="font-semibold tabular-nums ml-auto">
                  {formatEur(link.value)}
                </span>
              </div>
            );
            return (
              <path
                key={`${sidePrefix}-link-${i}`}
                d={linkPath(link) ?? ""}
                fill="none"
                stroke={`url(#${sidePrefix}-grad-${i})`}
                strokeOpacity={opacity}
                strokeWidth={Math.max(1, link.width ?? 1)}
                onMouseEnter={(e) => {
                  setFocus({ id: null, side });
                  onMouseEnter({ pageX: e.pageX, pageY: e.pageY }, tipContent);
                }}
                onMouseMove={(e) =>
                  onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                }
                onMouseLeave={() => {
                  setFocus({ id: null, side: null });
                  onMouseLeave();
                }}
                style={{
                  cursor: "pointer",
                  transition: "stroke-opacity 120ms",
                }}
              />
            );
          })}
        </g>
        <g>
          {layout.nodes.map((node) => {
            // Phantom source rects have no business in the leaf column —
            // they'd extend past the totals' baseline and visually break the
            // "income + deficit = expenses" alignment. Skip the rect, keep
            // the hatched ribbon: visually the deficit just appears at the
            // bottom of the revenue total (a hatched continuation of it).
            if (node.isPhantom) return null;
            const isFocus = focus.id === node.id;
            const isOnPath = focus.id != null && highlightedIds.has(node.id);
            // Focus: full bright. Path nodes (broader categories): dim — the
            // bright link itself enters the rect at the focus's exact share,
            // so the natural visual is a thin bright band where the link
            // arrives. Off-path: also dim, slightly more visible so the
            // surrounding context isn't completely lost.
            const baseOpacity = !focus.id
              ? 1
              : isFocus
                ? 1
                : isOnPath
                  ? 0.18
                  : 0.18;
            const y0 = node.y0 ?? 0;
            const y1 = node.y1 ?? 0;
            const yMid = (y0 + y1) / 2;
            const nodeHeight = Math.max(1, y1 - y0);
            // Label rule: outward from the bridge. Left side: labels LEFT of
            // the rect (anchor end). Right side (mirrored): labels RIGHT
            // (anchor start). Totals sit at the bridge edge — their labels
            // would collide with the balance columns, so we skip them.
            const labelOnRight = side === "spending";
            const minH = 11;
            const showLabel =
              node.type !== "total" && (nodeHeight >= minH || isOnPath);
            const sideTotalEur =
              node.side === "revenue"
                ? model.balance.revenueEur
                : model.balance.spendingEur;
            // Skip the %-of-side line on the total node itself (always 100%)
            // and on balance phantoms (they're the gap, not a budget item).
            const showShare =
              node.type !== "total" &&
              !node.isPhantom &&
              sideTotalEur > 0 &&
              node.valueEur > 0;
            const shareLabel =
              node.side === "revenue"
                ? t("budget_flow_of_revenue") || "of revenue"
                : t("budget_flow_of_spending") || "of spending";
            const tipContent = (
              <div className="flex flex-col gap-1 max-w-[260px]">
                <div className="font-medium">{node.label}</div>
                {node.groupLabel ? (
                  <div className="text-[11px] text-muted-foreground">
                    {node.groupLabel}
                  </div>
                ) : null}
                <div className="border-t border-border pt-1 font-semibold tabular-nums">
                  {formatEur(node.valueEur)}
                </div>
                {showShare ? (
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {((node.valueEur / sideTotalEur) * 100).toFixed(1)}%{" "}
                    {shareLabel}
                  </div>
                ) : null}
                {node.plannedEur != null && node.plannedEur !== 0 ? (
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {((node.valueEur / node.plannedEur) * 100).toFixed(1)}%{" "}
                    {t("budget_of_plan") || "of plan"}
                  </div>
                ) : null}
              </div>
            );
            const isLinked = node.ministryNodeId != null;
            // Total nodes get extra width extending INWARD into the SIDES_GAP
            // — they read as the focal "totals being compared" rather than
            // matching the thin leaf rects.
            const isTotal = node.type === "total";
            const renderX0 =
              isTotal && side === "spending"
                ? (node.x0 ?? 0) - TOTAL_INWARD
                : (node.x0 ?? 0);
            const renderX1 =
              isTotal && side === "revenue"
                ? (node.x1 ?? 0) + TOTAL_INWARD
                : (node.x1 ?? 0);
            const renderWidth = renderX1 - renderX0;
            return (
              <g
                key={`${sidePrefix}-node-${node.id}`}
                onMouseEnter={(e) => {
                  setFocus({ id: node.id, side });
                  onMouseEnter({ pageX: e.pageX, pageY: e.pageY }, tipContent);
                }}
                onMouseMove={(e) =>
                  onMouseMove({ pageX: e.pageX, pageY: e.pageY })
                }
                onMouseLeave={() => {
                  setFocus({ id: null, side: null });
                  onMouseLeave();
                }}
                onClick={() => {
                  if (node.ministryNodeId) {
                    navigate(`/budget/ministry/${node.ministryNodeId}`);
                  }
                }}
                style={{ cursor: isLinked ? "pointer" : "default" }}
              >
                {isTotal ? (
                  renderTotalWall({
                    node,
                    renderX0,
                    renderX1,
                    renderWidth,
                    y0,
                    y1,
                    baseOpacity,
                    balance: model.balance,
                    deficitLabel: t("budget_flow_wall_deficit") || "Deficit",
                    surplusLabel: t("budget_flow_wall_surplus") || "Surplus",
                  })
                ) : (
                  <rect
                    x={renderX0}
                    y={node.y0}
                    width={renderWidth}
                    height={nodeHeight}
                    fill={colorFor(node)}
                    fillOpacity={baseOpacity}
                  />
                )}
                {/* Slice overlay was confusing — the bright same-colour rect
                    inside a dim parent reads as a SECOND node (a duplicate
                    "Subsidies" inside "Expenditure"). The bright link that
                    enters the parent at exactly link.y1 already paints the
                    contributing slice naturally. */}
                {showLabel ? (
                  <text
                    x={labelOnRight ? renderX1 + 6 : renderX0 - 6}
                    y={yMid}
                    dy="0.35em"
                    textAnchor={labelOnRight ? "start" : "end"}
                    fontSize={11}
                    fillOpacity={isOnPath || !focus.id ? 1 : 0.4}
                    className="fill-foreground"
                    style={{ pointerEvents: "none" }}
                  >
                    {truncate(node.label, LABEL_MAX_CHARS)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </g>
    );
  };

  return (
    <>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={t("budget_flow_aria") || "State budget flow graphic"}
        className="block"
      >
        <defs>
          <pattern
            id={HATCH_PATTERN_ID}
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke={model.balance.isDeficit ? COLOR_DEFICIT : COLOR_SURPLUS}
              strokeOpacity="0.85"
              strokeWidth="3"
            />
          </pattern>
        </defs>
        {renderSide(layouts.left, "revenue", leftX)}
        {renderSide(layouts.right, "spending", rightX)}
      </svg>
      {tooltip}
    </>
  );
};

const truncate = (s: string, n: number): string =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;

// Wrapped so consumers don't have to import d3-sankey types.
export const BudgetFlowGraphic: FC<{
  model: BudgetFlowModel;
  width: number;
  height: number;
}> = (props) => {
  if (props.width <= 0 || props.height <= 0) return null;
  return <FlowSvg {...props} />;
};
