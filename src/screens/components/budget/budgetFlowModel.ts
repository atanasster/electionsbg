// Adapter — turns a KfpSnapshot into the {nodes, links} shape the budget-flow
// графика consumes. Two side-by-side d3-sankey graphs (revenue + spending)
// plus the balance bridge that closes the accounting identity in the middle.
//
// Hierarchy: leaves (depth 1, the small categories) flow into groups (depth 0
// subtotals like "Tax revenue") which flow into the section total node. A
// standalone depth-0 row (no subtotal — e.g. "Grants") connects directly to
// the section total. EU contribution (section III) renders as a single leaf
// on the spending side alongside Expenditure and Transfers (net).

import type {
  KfpSnapshot,
  KfpSnapshotLine,
  KfpSnapshotSection,
} from "@/data/budget/types";
import type { AdminFlowYear } from "@/data/budget/useBudget";

export type FlowSide = "revenue" | "spending";
export type FlowNodeType = "leaf" | "group" | "total";
export type FlowGrain = "economic" | "admin";

export interface FlowNode {
  id: string;
  label: string;
  type: FlowNodeType;
  side: FlowSide;
  // Original data so the tooltip can show context without re-walking the
  // snapshot. `groupLabel` is null for top-level leaves and groups.
  valueEur: number;
  plannedEur: number | null;
  groupLabel: string | null;
  // Admin-grain only: the budget admin nodeId so the SVG can route a click to
  // /budget/ministry/:id. Null for any economic-grain node.
  ministryNodeId: string | null;
  // Phantom nodes are the deficit/surplus padding added to the short side so
  // both totals occupy the same pixel height. Rendered with a hatched fill
  // (same pattern as the old bridge wedge).
  isPhantom?: boolean;
}

export interface FlowLink {
  source: string;
  target: string;
  valueEur: number;
}

export interface FlowGraph {
  nodes: FlowNode[];
  links: FlowLink[];
  totalEur: number;
  totalNodeId: string;
}

export interface BalanceBridge {
  revenueEur: number;
  spendingEur: number;
  // negative = deficit (financing borrowed to cover spending), positive = surplus
  balanceEur: number;
  isDeficit: boolean;
}

export interface BudgetFlowModel {
  fiscalYear: number;
  asOf: string;
  currency: "BGN" | "EUR";
  grain: FlowGrain;
  revenue: FlowGraph;
  spending: FlowGraph;
  balance: BalanceBridge;
  // Set by the admin-grain builder when its planned total ≠ the КФП revenue
  // (always true — admin grain only covers direct spending, not transfers).
  // The tile uses this to surface a caveat instead of misleading balance math.
  source: "kfp" | "law";
}

const labelOf = (
  bg: string,
  en: string | null | undefined,
  lang: "bg" | "en",
): string => (lang === "en" && en ? en : bg);

const sectionLabel = (s: KfpSnapshotSection, lang: "bg" | "en"): string =>
  labelOf(s.labelBg, s.labelEn, lang);

const lineLabel = (l: KfpSnapshotLine, lang: "bg" | "en"): string =>
  labelOf(l.labelBg, l.labelEn, lang);

// Depth-1 children of the subtotal at `subtotalIdx`, with their absolute line
// indices preserved so the caller can walk further down (depth-2 sub-leaves of
// a depth-1 subtotal). Walks forward until it hits another depth-0 row.
const childrenOfWithIdx = (
  lines: KfpSnapshotLine[],
  subtotalIdx: number,
): Array<{ row: KfpSnapshotLine; idx: number }> => {
  const out: Array<{ row: KfpSnapshotLine; idx: number }> = [];
  for (let j = subtotalIdx + 1; j < lines.length; j++) {
    if (lines[j].depth === 0) break;
    if (lines[j].depth === 1) out.push({ row: lines[j], idx: j });
  }
  return out;
};

// Depth-2 sub-leaves of the depth-1 subtotal at `depth1Idx`. Used on the
// spending side to render an outer column (e.g. "Лихви по външни заеми" /
// "Общини" / "Социалноосигурителни фондове") that flows into the depth-1 row.
// Stops at the next depth-0 or depth-1 row.
const depth2ChildrenOf = (
  lines: KfpSnapshotLine[],
  depth1Idx: number,
): KfpSnapshotLine[] => {
  const out: KfpSnapshotLine[] = [];
  for (let j = depth1Idx + 1; j < lines.length; j++) {
    if (lines[j].depth <= 1) break;
    if (lines[j].depth === 2) out.push(lines[j]);
  }
  return out;
};

// Build one side of the графика. `extraLeaves` lets the spending side fold in
// a section that has no internal lines (EU contribution is a single
// section-level value with `lines.length === 0`).
const buildGraph = (
  side: FlowSide,
  primarySection: KfpSnapshotSection,
  extraLeaves: KfpSnapshotSection[],
  totalLabel: string,
  lang: "bg" | "en",
): FlowGraph => {
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const totalNodeId = `${side}-total`;
  let totalEur = 0;

  const addNode = (n: FlowNode): void => {
    nodes.push(n);
  };

  // Walk top-level rows in order — every depth-0 row is either a subtotal
  // (decomposable group) or a standalone leaf. Subtotals get a group node +
  // leaf children; standalones get a leaf node feeding the total directly.
  const lines = primarySection.lines;
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    if (row.depth !== 0) continue;
    const valueEur = (row.executed ?? row.planned)?.amountEur ?? 0;
    if (valueEur === 0) continue;
    const planned = row.planned?.amountEur ?? null;
    if (row.isSubtotal) {
      const groupId = `${side}-group-${i}`;
      addNode({
        id: groupId,
        label: lineLabel(row, lang),
        type: "group",
        side,
        valueEur,
        plannedEur: planned,
        groupLabel: null,
        ministryNodeId: null,
      });
      links.push({
        source: groupId,
        target: totalNodeId,
        valueEur: Math.abs(valueEur),
      });
      const leafChildren = childrenOfWithIdx(lines, i);
      for (const { row: child, idx: childIdx } of leafChildren) {
        const cVal = (child.executed ?? child.planned)?.amountEur ?? 0;
        if (cVal === 0) continue;
        // Spending side: if the depth-1 row is itself a subtotal (Interest —
        // total / Provided transfers / Received transfers), we SKIP emitting
        // the depth-1 node and route its depth-2 children straight into the
        // depth-0 group. The chart then reads as a clean 3-column cascade —
        // terminal leaves → depth-0 categories (Expenditure / Transfers (net)
        // / EU) → total — with depth-1 aggregations folded away. If a depth-1
        // subtotal has no renderable depth-2 children (zero / missing values
        // across all of them), we fall back to emitting it as a terminal leaf
        // so the value still flows.
        const renderableSubs =
          side === "spending" && child.isSubtotal
            ? depth2ChildrenOf(lines, childIdx).filter((s) => {
                const v = (s.executed ?? s.planned)?.amountEur ?? 0;
                return v !== 0;
              })
            : [];
        if (renderableSubs.length > 0) {
          for (const sub of renderableSubs) {
            const sVal = (sub.executed ?? sub.planned)?.amountEur ?? 0;
            const subId = `${side}-subleaf-${childIdx}-${nodes.length}`;
            addNode({
              id: subId,
              label: lineLabel(sub, lang),
              type: "leaf",
              side,
              valueEur: sVal,
              plannedEur: sub.planned?.amountEur ?? null,
              // Tooltip context: show both the skipped depth-1 parent and the
              // depth-0 grandparent so the user can still see e.g. that
              // "Municipalities" sits under "Provided transfers · Transfers
              // (net)" even though Provided transfers isn't drawn as a node.
              groupLabel: `${lineLabel(child, lang)} · ${lineLabel(row, lang)}`,
              ministryNodeId: null,
            });
            links.push({
              source: subId,
              target: groupId,
              valueEur: Math.abs(sVal),
            });
          }
        } else {
          const leafId = `${side}-leaf-${i}-${childIdx}`;
          addNode({
            id: leafId,
            label: lineLabel(child, lang),
            type: "leaf",
            side,
            valueEur: cVal,
            plannedEur: child.planned?.amountEur ?? null,
            groupLabel: lineLabel(row, lang),
            ministryNodeId: null,
          });
          links.push({
            source: leafId,
            target: groupId,
            valueEur: Math.abs(cVal),
          });
        }
      }
      totalEur += valueEur;
    } else {
      const leafId = `${side}-leaf-${i}`;
      addNode({
        id: leafId,
        label: lineLabel(row, lang),
        type: "leaf",
        side,
        valueEur,
        plannedEur: planned,
        groupLabel: null,
        ministryNodeId: null,
      });
      links.push({
        source: leafId,
        target: totalNodeId,
        valueEur: Math.abs(valueEur),
      });
      totalEur += valueEur;
    }
  }

  // Folded-in sections (EU contribution) — render in the GROUP column
  // alongside Expenditure / Transfers (net), not as a depth-0 leaf. Without
  // this, d3-sankey places EU in the leaf column and its link to the total
  // has to snake across the side, overlapping other labels. To force depth-1
  // placement we give it an invisible "layout phantom" source — same value as
  // EU, no rendered rect, no rendered link (the renderer skips both).
  for (const sec of extraLeaves) {
    const v = (sec.executed ?? sec.planned)?.amountEur ?? 0;
    if (v === 0) continue;
    const groupId = `${side}-section-${sec.code}`;
    const layoutSrcId = `${groupId}-layout-src`;
    addNode({
      id: groupId,
      label: sectionLabel(sec, lang),
      type: "group",
      side,
      valueEur: v,
      plannedEur: sec.planned?.amountEur ?? null,
      groupLabel: null,
      ministryNodeId: null,
    });
    addNode({
      id: layoutSrcId,
      label: "",
      type: "leaf",
      side,
      valueEur: v,
      plannedEur: null,
      groupLabel: null,
      ministryNodeId: null,
      isPhantom: true,
    });
    links.push({
      source: layoutSrcId,
      target: groupId,
      valueEur: Math.abs(v),
    });
    links.push({
      source: groupId,
      target: totalNodeId,
      valueEur: Math.abs(v),
    });
    totalEur += v;
  }

  addNode({
    id: totalNodeId,
    label: totalLabel,
    type: "total",
    side,
    valueEur: totalEur,
    plannedEur: null,
    ministryNodeId: null,
    groupLabel: null,
  });

  return { nodes, links, totalEur, totalNodeId };
};

// Admin-grain spending — one leaf per ministry, sized by the State Budget Law
// plan. Top N ministries shown explicitly; the long tail folded into a single
// "Other spending units" leaf so the графика stays readable.
const TOP_MINISTRIES = 14;

const buildAdminSpendingGraph = (
  year: AdminFlowYear,
  totalLabel: string,
  otherLabel: string,
  lang: "bg" | "en",
): FlowGraph => {
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const totalNodeId = "spending-total";
  const ministries = year.ministries;
  const top = ministries.slice(0, TOP_MINISTRIES);
  const rest = ministries.slice(TOP_MINISTRIES);
  for (const m of top) {
    const id = `spending-ministry-${m.nodeId}`;
    nodes.push({
      id,
      label: lang === "en" && m.nameEn ? m.nameEn : m.nameBg,
      type: "leaf",
      side: "spending",
      valueEur: m.plannedEur,
      plannedEur: m.plannedEur,
      groupLabel: null,
      ministryNodeId: m.nodeId,
    });
    links.push({
      source: id,
      target: totalNodeId,
      valueEur: m.plannedEur,
    });
  }
  if (rest.length > 0) {
    const restSum = rest.reduce((a, m) => a + m.plannedEur, 0);
    if (restSum > 0) {
      const id = "spending-ministry-other";
      nodes.push({
        id,
        label: `${otherLabel} (${rest.length})`,
        type: "leaf",
        side: "spending",
        valueEur: restSum,
        plannedEur: restSum,
        groupLabel: null,
        ministryNodeId: null,
      });
      links.push({
        source: id,
        target: totalNodeId,
        valueEur: restSum,
      });
    }
  }
  nodes.push({
    id: totalNodeId,
    label: totalLabel,
    type: "total",
    side: "spending",
    valueEur: year.plannedTotalEur,
    plannedEur: year.plannedTotalEur,
    groupLabel: null,
    ministryNodeId: null,
  });
  return {
    nodes,
    links,
    totalEur: year.plannedTotalEur,
    totalNodeId,
  };
};

// Add a phantom "deficit" or "surplus" leaf to whichever side has the smaller
// total so both sides layout to the SAME pixel height. The phantom flows into
// that side's total node — d3-sankey then draws the total at full height with
// the bottom slice fed by the phantom (rendered hatched in the graphic).
//
// For a deficit (revenue < spending): phantom goes on the revenue side, label
// "Deficit (financing)". For a surplus: phantom goes on the spending side,
// label "Surplus" — visually shows that the spending column is shorter than
// revenue and the gap is the unspent surplus.
const addPhantomBalance = (
  revenue: FlowGraph,
  spending: FlowGraph,
  deficitLabel: string,
  surplusLabel: string,
): void => {
  const balance = revenue.totalEur - spending.totalEur;
  if (balance === 0) return;
  const phantomEur = Math.abs(balance);
  if (balance < 0) {
    // Deficit — phantom flows into the revenue total. Pushed LAST so d3-sankey
    // ranks it at the bottom of the leaf column and its link enters the
    // bottom of the total node (revenue solid on top, phantom hatched below).
    const id = "revenue-phantom-deficit";
    const totalIdx = revenue.nodes.findIndex(
      (n) => n.id === revenue.totalNodeId,
    );
    const total = revenue.nodes[totalIdx];
    const phantomNode: FlowNode = {
      id,
      label: deficitLabel,
      type: "leaf",
      side: "revenue",
      valueEur: phantomEur,
      plannedEur: null,
      groupLabel: null,
      ministryNodeId: null,
      isPhantom: true,
    };
    // Insert phantom right before the total so it sits as the last leaf.
    revenue.nodes.splice(totalIdx, 0, phantomNode);
    revenue.links.push({
      source: id,
      target: revenue.totalNodeId,
      valueEur: phantomEur,
    });
    if (total) total.valueEur += phantomEur;
  } else {
    const id = "spending-phantom-surplus";
    const totalIdx = spending.nodes.findIndex(
      (n) => n.id === spending.totalNodeId,
    );
    const total = spending.nodes[totalIdx];
    const phantomNode: FlowNode = {
      id,
      label: surplusLabel,
      type: "leaf",
      side: "spending",
      valueEur: phantomEur,
      plannedEur: null,
      groupLabel: null,
      ministryNodeId: null,
      isPhantom: true,
    };
    spending.nodes.splice(totalIdx, 0, phantomNode);
    spending.links.push({
      source: id,
      target: spending.totalNodeId,
      valueEur: phantomEur,
    });
    if (total) total.valueEur += phantomEur;
  }
};

export const snapshotToFlowModel = (
  snapshot: KfpSnapshot,
  lang: "bg" | "en",
  totals: {
    revenueLabel: string;
    spendingLabel: string;
    deficitLabel: string;
    surplusLabel: string;
  },
): BudgetFlowModel => {
  const revenueSection = snapshot.sections.find((s) => s.series === "revenue");
  const expenditureSection = snapshot.sections.find(
    (s) => s.series === "expenditure",
  );
  const euSection = snapshot.sections.find(
    (s) => s.series === "euContribution",
  );
  // The five sections are required — kfp.ts throws if any is missing — so
  // these casts are safe at runtime.
  if (!revenueSection || !expenditureSection) {
    throw new Error(
      "snapshotToFlowModel: missing revenue or expenditure section",
    );
  }

  const revenue = buildGraph(
    "revenue",
    revenueSection,
    [],
    totals.revenueLabel,
    lang,
  );
  const spending = buildGraph(
    "spending",
    expenditureSection,
    euSection ? [euSection] : [],
    totals.spendingLabel,
    lang,
  );
  const balanceEur = revenue.totalEur - spending.totalEur;
  // Capture totals BEFORE the phantom mutates the layout values, so the
  // headline strip and balance bridge keep showing the real numbers.
  const realRevenue = revenue.totalEur;
  const realSpending = spending.totalEur;
  addPhantomBalance(
    revenue,
    spending,
    totals.deficitLabel,
    totals.surplusLabel,
  );

  return {
    fiscalYear: snapshot.fiscalYear,
    asOf: snapshot.asOf,
    currency: snapshot.currency,
    grain: "economic",
    source: "kfp",
    revenue,
    spending,
    balance: {
      revenueEur: realRevenue,
      spendingEur: realSpending,
      balanceEur,
      isDeficit: balanceEur < 0,
    },
  };
};

// Admin-grain model: the spending side decomposes by ministry (planned, from
// the State Budget Law). The revenue side stays from КФП — the toggle is
// strictly about how to slice expenditure, the inflow story is unchanged.
// The balance bridge reflects the SAME revenue (КФП) against the SAME КФП
// spending total, so the bridge math stays honest; the admin Sankey on the
// right is a different decomposition of the same outflow.
export const snapshotToAdminFlowModel = (
  snapshot: KfpSnapshot,
  adminYear: AdminFlowYear,
  lang: "bg" | "en",
  totals: {
    revenueLabel: string;
    spendingLabel: string;
    otherLabel: string;
    deficitLabel: string;
    surplusLabel: string;
  },
): BudgetFlowModel => {
  const revenueSection = snapshot.sections.find((s) => s.series === "revenue");
  if (!revenueSection) {
    throw new Error(
      "snapshotToAdminFlowModel: missing revenue section in snapshot",
    );
  }
  const revenue = buildGraph(
    "revenue",
    revenueSection,
    [],
    totals.revenueLabel,
    lang,
  );
  const spending = buildAdminSpendingGraph(
    adminYear,
    totals.spendingLabel,
    totals.otherLabel,
    lang,
  );
  const balanceEur = revenue.totalEur - spending.totalEur;
  const realRevenue = revenue.totalEur;
  const realSpending = spending.totalEur;
  addPhantomBalance(
    revenue,
    spending,
    totals.deficitLabel,
    totals.surplusLabel,
  );
  return {
    fiscalYear: snapshot.fiscalYear,
    asOf: snapshot.asOf,
    currency: snapshot.currency,
    grain: "admin",
    source: "law",
    revenue,
    spending,
    balance: {
      revenueEur: realRevenue,
      spendingEur: realSpending,
      balanceEur,
      isDeficit: balanceEur < 0,
    },
  };
};
