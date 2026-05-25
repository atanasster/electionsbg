// The budget-flow графика. Two independent d3-sankey flows that share a single
// euros-per-pixel scale so the two total walls are honest visual comparisons:
//   left   — revenue: items → categories → Revenue total (right edge). Laid
//            out by d3-sankey, then mirrored on x so the total ends up on the
//            inner edge.
//   right  — spending: Spending total (left edge) → categories → items.
//
// Both walls are TOP-aligned to the top of the chart. The side with the larger
// total fills the full chart height; the shorter side is rescaled to share the
// other side's euros-per-pixel ratio. The deficit (or surplus) is rendered as
// a HATCHED CONTINUATION of the shorter wall — same x column, extending down
// from the wall's bottom to the chart baseline. Visual identity:
//     revenue wall + deficit hatch = spending wall      (deficit case)
//     spending wall + surplus hatch = revenue wall      (surplus case)

import { FC, useEffect, useMemo, useRef, useState } from "react";
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
// Total walls render a bit wider than leaf rects — they're the focal columns
// flanking the empty center, and the deficit hatch continues straight down at
// the same width.
const TOTAL_NODE_WIDTH = 32;
const NODE_PADDING = 2;
// Visual breathing room between the two side Sankeys. The deficit is no
// longer in the gap (it's stacked under the shorter wall), so this can be
// modest — just enough that the two walls don't kiss.
const SIDES_GAP = 80;
// Outer label gutter. Leaves sit on the outer edges of each side; their
// labels — and inline values — extend OUTWARD past the sankey extent.
const LABEL_MARGIN = 220;
// Outer leaves render in the LABEL_MARGIN gutter — plenty of horizontal room.
// Group / inner-column labels live in the link space between leaf and total,
// so they need a tighter cap to avoid horizontally bleeding into the leaf
// column at narrower chart widths.
const LABEL_MAX_CHARS_LEAF = 30;
const LABEL_MAX_CHARS_INNER = 20;
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

// Compact Euro formatter for inline value labels and wall captions: "€5.46 B",
// "€397 M", "€80 K". Tooltips still carry the full formatEur figure.
const compactEur = (value: number): string => {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}€${(abs / 1e9).toFixed(2)} B`;
  if (abs >= 1e6) return `${sign}€${Math.round(abs / 1e6)} M`;
  if (abs >= 1e3) return `${sign}€${Math.round(abs / 1e3)} K`;
  return `${sign}€${Math.round(abs)}`;
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
    .nodeAlign(align === "right" ? sankeyRight : sankeyLeft)
    // null = preserve input order within each column. The default (minimum-
    // overlap) heuristic interleaves outer leaves whose targets are different
    // depth-0 groups; input order matches the model's parent-grouped emission.
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

  // Post-layout: re-stack each parent's single-outgoing children TIGHTLY inside
  // the parent's y range. d3-sankey allocates padding PER COLUMN — the column
  // with the most nodes loses the most height to padding, so columns with
  // fewer nodes (e.g. the groups column with 3 nodes vs. the items column
  // with 11) end up with extra space and DON'T sit flush inside the wall's y
  // range. Two passes:
  //   1. align groups inside their wall's y range (so e.g. EU contribution
  //      doesn't poke out below the spending wall),
  //   2. align leaves inside their group's y range.
  // Pass 1 must come first so the groups land in their final positions before
  // pass 2 anchors leaves to them.
  const CHILD_GAP = 4;
  const restackChildrenInsideParents = (
    parentType: "group" | "total",
  ): void => {
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
      if (target.type !== parentType) continue;
      const list = parentToChildren.get(target.id) ?? [];
      list.push(node);
      parentToChildren.set(target.id, list);
    }
    for (const [parentId, children] of parentToChildren) {
      const parent = result.nodes.find((n) => n.id === parentId);
      if (!parent) continue;
      const parentY0 = parent.y0 ?? 0;
      const parentY1 = parent.y1 ?? 0;
      const parentH = parentY1 - parentY0;
      children.sort((a, b) => (a.y0 ?? 0) - (b.y0 ?? 0));
      const totalChildH = children.reduce(
        (sum, c) => sum + Math.max(0, (c.y1 ?? 0) - (c.y0 ?? 0)),
        0,
      );
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
  };
  restackChildrenInsideParents("total");
  restackChildrenInsideParents("group");
  return result;
};

// Bring both sides onto the SAME euros-per-pixel scale and TOP-align both
// total walls to y=1. d3-sankey runs per-side, so each side independently
// scales its total to fill the available height — meaning the two walls end
// up visually equal even when one side has way more euros. After this pass,
// the side with the LARGER total fills the full chart height; the shorter
// side shrinks proportionally. The deficit (or surplus) hatch then fills the
// visual gap below the shorter wall, in the wall's own x column.
const alignSidesByEurScale = (
  left: SankeyLayoutResult,
  right: SankeyLayoutResult,
): void => {
  const leftWall = left.nodes.find((n) => n.type === "total");
  const rightWall = right.nodes.find((n) => n.type === "total");
  if (!leftWall || !rightWall) return;
  const leftH = (leftWall.y1 ?? 0) - (leftWall.y0 ?? 0);
  const rightH = (rightWall.y1 ?? 0) - (rightWall.y0 ?? 0);
  const leftEur = leftWall.valueEur;
  const rightEur = rightWall.valueEur;
  if (leftH <= 0 || rightH <= 0 || leftEur <= 0 || rightEur <= 0) return;
  const leftPxPerEur = leftH / leftEur;
  const rightPxPerEur = rightH / rightEur;
  // Pick the smaller pixels-per-eur (= the side with the LARGER total) as the
  // target so neither wall overflows the chart height.
  const targetPxPerEur = Math.min(leftPxPerEur, rightPxPerEur);
  const apply = (
    layout: SankeyLayoutResult,
    wall: SankeyNode<NodeDatum, LinkDatum>,
    currentPxPerEur: number,
  ): void => {
    const scale = targetPxPerEur / currentPxPerEur;
    const wallY0After = (wall.y0 ?? 0) * scale;
    // TOP-align: shift so the wall's y0 lands at 1 (the chart's top inset).
    const translate = 1 - wallY0After;
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
  apply(left, leftWall, leftPxPerEur);
  apply(right, rightWall, rightPxPerEur);
};

// Mirror x-coordinates of all nodes inside a layout AND re-bind each link to
// point at the mirrored nodes (otherwise link.source / link.target still
// reference the pre-mirror objects, and the link curve gets drawn between the
// pre-mirror x positions — which after the rest of the chart has flipped
// looks like the item→group ribbons and the group→wall ribbon are SWAPPED).
const mirrorX = (
  layout: SankeyLayoutResult,
  width: number,
): SankeyLayoutResult => {
  const oldToNew = new Map<
    SankeyNode<NodeDatum, LinkDatum>,
    SankeyNode<NodeDatum, LinkDatum>
  >();
  const nodes = layout.nodes.map((n) => {
    const newNode: SankeyNode<NodeDatum, LinkDatum> = {
      ...n,
      x0: width - (n.x1 ?? 0),
      x1: width - (n.x0 ?? 0),
    };
    oldToNew.set(n, newNode);
    return newNode;
  });
  const links = layout.links.map((l) => ({
    ...l,
    source:
      oldToNew.get(l.source as SankeyNode<NodeDatum, LinkDatum>) ?? l.source,
    target:
      oldToNew.get(l.target as SankeyNode<NodeDatum, LinkDatum>) ?? l.target,
  }));
  return { nodes, links };
};

// Path generator for the MIRRORED side. d3-sankey's sankeyLinkHorizontal uses
// source.x1 (source's right edge) and target.x0 (target's left edge) — correct
// for a normal left-to-right Sankey where source sits to the LEFT of target.
// After mirror, the source rect is now to the RIGHT of the target rect, so
// we want source's LEFT edge (x0) and target's RIGHT edge (x1) — the inner
// edges that face the gap between them. Otherwise the curve overshoots both
// rects and gets drawn in the wrong column.
const mirroredLinkPath = (link: SankeyLink<NodeDatum, LinkDatum>): string => {
  const s = link.source as SankeyNode<NodeDatum, LinkDatum>;
  const t = link.target as SankeyNode<NodeDatum, LinkDatum>;
  const sx = s.x0 ?? 0;
  const tx = t.x1 ?? 0;
  const sy = link.y0 ?? 0;
  const ty = link.y1 ?? 0;
  const mid = (sx + tx) / 2;
  return `M${sx},${sy}C${mid},${sy} ${mid},${ty} ${tx},${ty}`;
};

interface LabelPlacement {
  // Resolved vertical center of the label after collision avoidance.
  y: number;
  // True if this label survived dropping (collision pass keeps the highest-
  // value labels first when the column can't fit them all).
  show: boolean;
  // True if the label was pushed far enough from the node's midpoint that a
  // thin leader line should connect rect → label so the association reads.
  hasLeader: boolean;
}

// Empirical text bbox heights for the rendered labels. Both label and value
// share the same dy ("0.35em") and font baseline math, so two stacked labels
// occupy LABEL_BBOX_H + VALUE_BBOX_H plus a small gap between adjacent slots.
const LABEL_BBOX_H = 13;
const VALUE_BBOX_H = 11;
const LABEL_PAIR_GAP = 2;
// Vertical offset between label baseline and value baseline. Keeps the value
// line directly under the label without re-shifting the label itself.
const VALUE_OFFSET_Y = 13;

// Greedy collision avoidance for a single column of stacked labels. Labels
// start centered on their node's midpoint, then a two-pass (forward+backward)
// sweep enforces a minimum vertical gap that reserves room for label + value
// rendered as a pair. If the column doesn't have enough pixel height for every
// label, drop the smallest-value labels first so the largest flows always read.
const placeColumnLabels = (
  items: Array<{
    id: string;
    nodeY0: number;
    nodeY1: number;
    valueEur: number;
  }>,
  chartHeight: number,
): Map<string, LabelPlacement> => {
  const result = new Map<string, LabelPlacement>();
  if (items.length === 0) return result;

  const enriched = items.map((it) => ({
    ...it,
    nodeMid: (it.nodeY0 + it.nodeY1) / 2,
  }));

  // minStep must clear the label + value pair so adjacent labels never overlap
  // even when the upper one shows its inline value.
  const minStep = LABEL_BBOX_H + VALUE_BBOX_H + LABEL_PAIR_GAP;
  const maxLabels = Math.max(
    1,
    Math.floor((chartHeight + LABEL_PAIR_GAP) / minStep),
  );

  let hidden = new Set<string>();
  if (enriched.length > maxLabels) {
    const sortedByVal = [...enriched].sort((a, b) => a.valueEur - b.valueEur);
    hidden = new Set(
      sortedByVal.slice(0, enriched.length - maxLabels).map((it) => it.id),
    );
  }

  const visible = enriched
    .filter((it) => !hidden.has(it.id))
    .sort((a, b) => a.nodeMid - b.nodeMid);

  const ys = visible.map((it) => it.nodeMid);

  for (let i = 1; i < ys.length; i++) {
    const min = ys[i - 1] + minStep;
    if (ys[i] < min) ys[i] = min;
  }
  for (let i = ys.length - 1; i > 0; i--) {
    const max = ys[i] - minStep;
    if (ys[i - 1] > max) ys[i - 1] = max;
  }
  if (ys.length > 0) {
    const topInset = LABEL_BBOX_H / 2 + 1;
    // Bottom inset accounts for the value line that renders below the last
    // label center, so neither label nor value bleeds past the chart edge.
    const bottomInset = VALUE_OFFSET_Y + VALUE_BBOX_H / 2 + 1;
    ys[0] = Math.max(topInset, ys[0]);
    ys[ys.length - 1] = Math.min(chartHeight - bottomInset, ys[ys.length - 1]);
    for (let i = 1; i < ys.length; i++) {
      const min = ys[i - 1] + minStep;
      if (ys[i] < min) ys[i] = min;
    }
  }

  for (let i = 0; i < visible.length; i++) {
    const it = visible[i];
    const y = ys[i];
    const nodeH = it.nodeY1 - it.nodeY0;
    const hasLeader = Math.abs(y - it.nodeMid) > Math.max(2, nodeH / 2 + 1);
    result.set(it.id, { y, show: true, hasLeader });
  }
  for (const it of enriched) {
    if (!result.has(it.id)) {
      result.set(it.id, {
        y: it.nodeMid,
        show: false,
        hasLeader: false,
      });
    }
  }
  return result;
};

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
// position+size linearly; rects only in `to` snap to their final position.
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
      if (!prev) return target;
      return {
        ...target,
        x0: lerp(prev.x0 ?? 0, target.x0 ?? 0),
        x1: lerp(prev.x1 ?? 0, target.x1 ?? 0),
        y0: lerp(prev.y0 ?? 0, target.y0 ?? 0),
        y1: lerp(prev.y1 ?? 0, target.y1 ?? 0),
      };
    });
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
  onNodeClick?: (node: {
    id: string;
    label: string;
    side: "left" | "right";
  }) => void;
  // Optional predicate — if provided, only nodes for which it returns true
  // show a pointer cursor + fire onNodeClick. Default (predicate omitted) is
  // "every node is clickable" for backward compatibility with the original
  // behaviour, but callers that wire onNodeClick to a category-specific
  // handler should pass a predicate so dead clicks don't mislead users.
  isNodeClickable?: (node: {
    id: string;
    label: string;
    side: "left" | "right";
  }) => boolean;
}> = ({ model, width, height, onNodeClick, isNodeClickable }) => {
  const { t } = useTranslation();
  const { tooltip, onMouseEnter, onMouseMove, onMouseLeave } = useTooltip();
  const [focus, setFocus] = useState<FocusState>({ id: null, side: null });

  const innerWidth = width - 2 * LABEL_MARGIN;
  const sideWidth = (innerWidth - SIDES_GAP) / 2;
  const leftX = LABEL_MARGIN;
  const rightX = leftX + sideWidth + SIDES_GAP;

  const targetLayouts = useMemo<AnimatedLayouts | null>(() => {
    const left = layoutGraph(model.revenue, sideWidth, height, "right");
    const right = layoutGraph(model.spending, sideWidth, height, "right");
    if (!left || !right) return null;
    alignSidesByEurScale(left, right);
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

  const [displayed, setDisplayed] = useState<AnimatedLayouts | null>(
    targetLayouts,
  );
  const previousRef = useRef<{
    layouts: AnimatedLayouts | null;
    modelKey: string;
  }>({
    layouts: targetLayouts,
    modelKey: `${model.fiscalYear}`,
  });
  useEffect(() => {
    if (!targetLayouts) return;
    const modelKey = `${model.fiscalYear}`;
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
  }, [targetLayouts, model.fiscalYear]);

  const layouts = displayed;

  // Highlight set: walk DOWNSTREAM and UPSTREAM separately, never reversing
  // mid-walk. Otherwise the trace leaks across siblings via the shared total.
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
    const mirrored = side === "spending";
    const pathOf = mirrored ? mirroredLinkPath : linkPath;
    // Per-column label placement: leaves and groups live at different x
    // columns, so collision avoidance runs once per column. Total walls have
    // their own rotated caption and are excluded here.
    const placements = new Map<string, LabelPlacement>();
    const columns = new Map<number, Array<SankeyNode<NodeDatum, LinkDatum>>>();
    for (const node of layout.nodes) {
      if (node.isPhantom || node.type === "total") continue;
      const key = Math.round(node.x0 ?? 0);
      const list = columns.get(key) ?? [];
      list.push(node);
      columns.set(key, list);
    }
    for (const [, columnNodes] of columns) {
      const colPlacements = placeColumnLabels(
        columnNodes.map((n) => ({
          id: n.id,
          nodeY0: n.y0 ?? 0,
          nodeY1: n.y1 ?? 0,
          valueEur: n.valueEur,
        })),
        height,
      );
      for (const [id, p] of colPlacements) placements.set(id, p);
    }
    // Identify the OUTER column (the one in the LABEL_MARGIN gutter): on
    // revenue side that's the lowest x0; on spending (mirrored) it's the
    // highest x0. Labels in the outer column get the full truncation budget;
    // labels in any inner column (groups + direct-to-total leaves) get the
    // tighter cap to keep them from bleeding into the leaf column.
    const columnXs = [...columns.keys()].sort((a, b) => a - b);
    const outerColumnX = mirrored
      ? (columnXs[columnXs.length - 1] ?? -Infinity)
      : (columnXs[0] ?? Infinity);
    return (
      <g transform={`translate(${offsetX}, 0)`} key={side}>
        <defs>
          {layout.links.map((link, i) => {
            const s = link.source as SankeyNode<NodeDatum, LinkDatum>;
            const tgt = link.target as SankeyNode<NodeDatum, LinkDatum>;
            // Gradient endpoints must match the actual curve x range. On the
            // mirrored side the curve uses source.x0 → target.x1; on the
            // revenue side it uses source.x1 → target.x0.
            const gx1 = mirrored ? (s.x0 ?? 0) : (s.x1 ?? 0);
            const gx2 = mirrored ? (tgt.x1 ?? 0) : (tgt.x0 ?? 0);
            return (
              <linearGradient
                key={`${sidePrefix}-grad-${i}`}
                id={`${sidePrefix}-grad-${i}`}
                gradientUnits="userSpaceOnUse"
                x1={Math.min(gx1, gx2)}
                x2={Math.max(gx1, gx2)}
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
            // Layout phantoms (invisible source forcing EU into the group
            // column) have no rendered link.
            if (s.isPhantom || tgt.isPhantom) return null;
            const isFocusDirectLink =
              focus.id != null && (s.id === focus.id || tgt.id === focus.id);
            const opacity = !focus.id ? 0.45 : isFocusDirectLink ? 0.78 : 0.07;
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
                d={pathOf(link) ?? ""}
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
            if (node.isPhantom) return null;
            const isFocus = focus.id === node.id;
            const isOnPath = focus.id != null && highlightedIds.has(node.id);
            const baseOpacity = !focus.id || isFocus ? 1 : 0.18;
            const y0 = node.y0 ?? 0;
            const y1 = node.y1 ?? 0;
            const yMid = (y0 + y1) / 2;
            const nodeHeight = Math.max(1, y1 - y0);
            const isTotal = node.type === "total";
            // Total nodes get extra width relative to the leaf rects so they
            // read as the focal columns. The hatched deficit/surplus extends
            // straight down from the wall at this same width.
            const renderX0 =
              isTotal && side === "spending"
                ? (node.x0 ?? 0) - (TOTAL_NODE_WIDTH - NODE_WIDTH)
                : (node.x0 ?? 0);
            const renderX1 =
              isTotal && side === "revenue"
                ? (node.x1 ?? 0) + (TOTAL_NODE_WIDTH - NODE_WIDTH)
                : (node.x1 ?? 0);
            const renderWidth = renderX1 - renderX0;

            const labelOnRight = side === "spending";
            const labelX = labelOnRight ? renderX1 + 6 : renderX0 - 6;
            const anchor = labelOnRight ? "start" : "end";
            const placement = placements.get(node.id);
            const placedShow = placement?.show ?? false;
            const showLabel = !isTotal && (placedShow || isOnPath);
            // Placed labels get their resolved Y from the collision pass;
            // hover-only labels (dropped by collision) fall back to the
            // node's natural midpoint.
            const labelY = placedShow ? (placement?.y ?? yMid) : yMid;
            // Inline €-value sits one line below the label. The collision
            // step already reserves room for both, so the value renders
            // whenever the label does.
            const showInlineValue = !isTotal && showLabel;
            const hasLeader = placedShow && (placement?.hasLeader ?? false);
            const labelOpacity = isOnPath || !focus.id ? 1 : 0.4;
            const valueOpacity = isOnPath || !focus.id ? 0.7 : 0.3;
            const leaderOpacity = !focus.id || isOnPath ? 0.35 : 0.1;

            const sideTotalEur =
              node.side === "revenue"
                ? model.balance.revenueEur
                : model.balance.spendingEur;
            const showShare = !isTotal && sideTotalEur > 0 && node.valueEur > 0;
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
                {node.plannedEur != null &&
                node.plannedEur !== 0 &&
                node.valueEur !== node.plannedEur ? (
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {((node.valueEur / node.plannedEur) * 100).toFixed(1)}%{" "}
                    {t("budget_of_plan") || "of plan"}
                  </div>
                ) : null}
              </div>
            );
            const clickSide: "left" | "right" =
              side === "revenue" ? "left" : "right";
            const clickable =
              onNodeClick != null &&
              (!isNodeClickable ||
                isNodeClickable({
                  id: node.id,
                  label: node.label,
                  side: clickSide,
                }));
            return (
              <g
                key={`${sidePrefix}-node-${node.id}`}
                style={{ cursor: clickable ? "pointer" : undefined }}
                onClick={(e) => {
                  if (clickable) {
                    e.stopPropagation();
                    onNodeClick!({
                      id: node.id,
                      label: node.label,
                      side: clickSide,
                    });
                  }
                }}
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
              >
                <rect
                  x={renderX0}
                  y={y0}
                  width={renderWidth}
                  height={nodeHeight}
                  fill={colorFor(node)}
                  fillOpacity={baseOpacity}
                />
                {isTotal && nodeHeight >= 30 ? (
                  <text
                    x={(renderX0 + renderX1) / 2}
                    y={yMid}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={13}
                    fontWeight={600}
                    fill="white"
                    transform={`rotate(-90 ${(renderX0 + renderX1) / 2} ${yMid})`}
                    style={{ pointerEvents: "none" }}
                  >
                    {node.label} · {compactEur(node.valueEur)}
                  </text>
                ) : null}
                {hasLeader && showLabel ? (
                  <line
                    x1={labelOnRight ? renderX1 : renderX0}
                    y1={yMid}
                    x2={labelOnRight ? labelX - 1 : labelX + 1}
                    y2={labelY}
                    stroke="currentColor"
                    strokeOpacity={leaderOpacity}
                    strokeWidth={0.75}
                    className="text-muted-foreground"
                    style={{ pointerEvents: "none" }}
                  />
                ) : null}
                {showLabel ? (
                  <text
                    x={labelX}
                    y={labelY}
                    dy="0.35em"
                    textAnchor={anchor}
                    fontSize={11}
                    fillOpacity={labelOpacity}
                    className="fill-foreground"
                    style={{ cursor: "pointer" }}
                  >
                    {truncate(
                      node.label,
                      Math.round(node.x0 ?? 0) === outerColumnX
                        ? LABEL_MAX_CHARS_LEAF
                        : LABEL_MAX_CHARS_INNER,
                    )}
                  </text>
                ) : null}
                {showInlineValue ? (
                  <text
                    x={labelX}
                    y={labelY + VALUE_OFFSET_Y}
                    dy="0.35em"
                    textAnchor={anchor}
                    fontSize={10}
                    fontWeight={600}
                    fillOpacity={valueOpacity}
                    className="fill-foreground"
                    style={{ cursor: "pointer" }}
                  >
                    {compactEur(node.valueEur)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
        {renderHatchExtension(layout, side)}
      </g>
    );
  };

  // Hatched continuation of the SHORTER wall — fills the visual gap from the
  // wall's bottom down to the chart baseline so that solid wall + hatched
  // extension equals the OTHER wall's height. In a deficit (revenue < spend)
  // it sits below the revenue wall; in a surplus it sits below the spending
  // wall. Same x range as the wall — reads as a continuation, not a sibling.
  const renderHatchExtension = (
    layout: SankeyLayoutResult,
    side: "revenue" | "spending",
  ): React.ReactNode => {
    const { balance } = model;
    if (balance.balanceEur === 0) return null;
    const isShorter =
      (balance.isDeficit && side === "revenue") ||
      (!balance.isDeficit && balance.balanceEur > 0 && side === "spending");
    if (!isShorter) return null;
    const wall = layout.nodes.find((n) => n.type === "total");
    // Use the OTHER side's wall y1 as the baseline so that
    //   shorter wall + hatch = taller wall   pixel-for-pixel.
    // Using the chart bottom would leave a gap when d3-sankey's per-side
    // padding makes the taller wall stop short of the chart bottom.
    const otherLayout = side === "revenue" ? layouts.right : layouts.left;
    const otherWall = otherLayout.nodes.find((n) => n.type === "total");
    if (!wall || !otherWall) return null;
    const wallY1 = wall.y1 ?? 0;
    const baselineY = otherWall.y1 ?? 0;
    const extHeight = baselineY - wallY1;
    if (extHeight <= 0) return null;
    const renderX0 =
      side === "spending"
        ? (wall.x0 ?? 0) - (TOTAL_NODE_WIDTH - NODE_WIDTH)
        : (wall.x0 ?? 0);
    const renderX1 =
      side === "revenue"
        ? (wall.x1 ?? 0) + (TOTAL_NODE_WIDTH - NODE_WIDTH)
        : (wall.x1 ?? 0);
    const renderWidth = renderX1 - renderX0;
    const fill = balance.isDeficit ? COLOR_DEFICIT : COLOR_SURPLUS;
    const captionFill = balance.isDeficit ? "#9f1239" : "#065f46";
    const cx = (renderX0 + renderX1) / 2;
    const cy = wallY1 + extHeight / 2;
    const label = balance.isDeficit
      ? t("budget_flow_wall_deficit") || "Deficit"
      : t("budget_flow_wall_surplus") || "Surplus";
    const fullTip = (
      <div className="flex flex-col gap-1 max-w-[260px]">
        <div className="font-medium">
          {balance.isDeficit
            ? t("budget_flow_legend_deficit") || "Deficit (financing)"
            : t("budget_flow_legend_surplus") || "Surplus"}
        </div>
        <div className="border-t border-border pt-1 font-semibold tabular-nums">
          {formatEur(Math.abs(balance.balanceEur))}
        </div>
        <div className="text-[11px] text-muted-foreground tabular-nums">
          {(
            (Math.abs(balance.balanceEur) / Math.max(balance.spendingEur, 1)) *
            100
          ).toFixed(1)}
          % {t("budget_flow_of_spending") || "of spending"}
        </div>
      </div>
    );
    return (
      <g
        onMouseEnter={(e) => {
          setFocus({ id: null, side: "bridge" });
          onMouseEnter({ pageX: e.pageX, pageY: e.pageY }, fullTip);
        }}
        onMouseMove={(e) => onMouseMove({ pageX: e.pageX, pageY: e.pageY })}
        onMouseLeave={() => {
          setFocus({ id: null, side: null });
          onMouseLeave();
        }}
        style={{ cursor: "pointer" }}
      >
        <rect
          x={renderX0}
          y={wallY1}
          width={renderWidth}
          height={extHeight}
          fill={fill}
          fillOpacity={0.18}
        />
        <rect
          x={renderX0}
          y={wallY1}
          width={renderWidth}
          height={extHeight}
          fill={`url(#${HATCH_PATTERN_ID})`}
        />
        {extHeight >= 30 ? (
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={13}
            fontWeight={600}
            fill={captionFill}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ pointerEvents: "none" }}
          >
            {label} · {compactEur(Math.abs(balance.balanceEur))}
          </text>
        ) : null}
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

export const BudgetFlowGraphic: FC<{
  model: BudgetFlowModel;
  width: number;
  height: number;
  onNodeClick?: (node: {
    id: string;
    label: string;
    side: "left" | "right";
  }) => void;
  isNodeClickable?: (node: {
    id: string;
    label: string;
    side: "left" | "right";
  }) => boolean;
}> = (props) => {
  if (props.width <= 0 || props.height <= 0) return null;
  return <FlowSvg {...props} />;
};
