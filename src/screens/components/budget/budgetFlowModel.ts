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
import type {
  AdminFlowYear,
  PlannedTree,
  PlannedTreeLine,
} from "@/data/budget/useBudget";

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

// Translation map for the planned-revenue tree headings. The pipeline only
// emits the Bulgarian label, so the EN side maps from a curated table —
// keys are the trimmed Bulgarian labels from ЗДБРБ Чл. 1.
const PLANNED_REVENUE_EN: Record<string, string> = {
  "ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ": "Revenue, grants and donations",
  "Данъчни приходи": "Tax revenue",
  "Корпоративен данък": "Corporate income tax",
  "Данъци върху дивидентите, ликвидационните дялове и доходите на юридически лица":
    "Taxes on dividends, liquidation shares and other income of legal entities",
  "Данъци върху доходите на физически лица": "Personal income tax",
  "Данък върху добавената стойност": "Value added tax",
  Акцизи: "Excise duties",
  "Данък върху застрахователните премии": "Insurance premium tax",
  "Мита и митнически такси": "Customs duties",
  "Други данъци": "Other taxes",
  "Неданъчни приходи": "Non-tax revenue",
  "Помощи и дарения": "Grants and donations",
};

const PLANNED_TRANSFERS_EN: Record<string, string> = {
  "БЮДЖЕТНИ ВЗАИМООТНОШЕНИЯ (ТРАНСФЕРИ) - НЕТО": "Transfers (net)",
  "БЮДЖЕТНИ ВЗАИМООТНОШЕНИЯ (ТРАНСФЕРИ) – НЕТО": "Transfers (net)",
  "Предоставени трансфери за:": "Provided transfers",
  "Получени трансфери от:": "Received transfers",
  Общините: "Municipalities",
  "Държавното обществено осигуряване": "State social security (NSSI)",
  "Националната здравноосигурителна каса": "National Health Insurance Fund",
  "Сметката за средствата от Европейския съюз на Националния фонд":
    "EU funds at the National Fund",
  "Сметката за средствата от Европейския съюз на Държавния фонд „Земеделие“":
    "EU funds at the State Agriculture Fund",
};

const lookupEn = (bg: string, table: Record<string, string>): string | null => {
  const key = bg.replace(/\s+/g, " ").trim();
  return table[key] ?? null;
};

// Lift a PlannedTree (planned revenue from SBL Чл. 1) into the same
// KfpSnapshotSection shape buildGraph consumes — the Sankey doesn't care that
// the source is the SBL plan rather than the КФП execution feed, only that
// the depth/isSubtotal hierarchy matches. Drops depth ≥ 2 sub-rows; they're
// fine-print details that would clutter the графика.
const plannedRevenueToSection = (
  tree: PlannedTree,
  enTable: Record<string, string>,
): KfpSnapshotSection => {
  const lines: KfpSnapshotLine[] = tree.lines
    .filter((l) => l.depth <= 1)
    .map((l) => ({
      labelBg: l.labelBg,
      labelEn: lookupEn(l.labelBg, enTable) ?? l.labelBg,
      planned: {
        amount: l.plannedEur,
        amountEur: l.plannedEur,
        currency: "EUR",
      },
      executed: null,
      depth: l.depth,
      isSubtotal: l.isSubtotal,
      groupLabelBg: null,
      groupLabelEn: null,
    }));
  return {
    code: "I",
    series: "revenue",
    kind: "revenue",
    labelBg: "ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ",
    labelEn: "Revenue, grants and donations",
    planned: {
      amount: tree.totalEur,
      amountEur: tree.totalEur,
      currency: "EUR",
    },
    executed: null,
    lines,
  };
};

// Admin-grain spending — one leaf per ministry, sized by the State Budget Law
// plan. Top N ministries shown explicitly; the long tail folded into a single
// "Other spending units" leaf so the графика stays readable.
const TOP_MINISTRIES = 14;

// Admin-grain spending — three depth-0 groups feed the total:
//   • Section II "Direct" → per-ministry leaves + "Central budget" gap leaf
//     (Section II is wider than the sum of direct ministry appropriations
//     because of central reserves and общи разходи that don't pin to a unit).
//   • Section III "Transfers (net)" → per-recipient leaves (Общини, ДОО, НЗОК,
//     EU funds, …).
//   • Section IV "EU contribution" → single leaf (no internal decomposition).
// Total = II + III + IV, which reconciles to the law's framework spending.
// Falls back to the legacy "one group per ministry" layout when the framework
// data isn't available (older fiscal years).
const buildAdminSpendingGraph = (
  year: AdminFlowYear,
  labels: {
    totalLabel: string;
    otherLabel: string;
    directGroupLabel: string;
    centralBudgetLabel: string;
    transfersGroupLabel: string;
    euContributionLabel: string;
  },
  lang: "bg" | "en",
): FlowGraph => {
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const totalNodeId = "spending-total";
  const ministries = year.ministries;
  const top = ministries.slice(0, TOP_MINISTRIES);
  const rest = ministries.slice(TOP_MINISTRIES);

  const hasFramework =
    year.plannedSectionIIEur != null &&
    year.plannedTransfers != null &&
    year.plannedEuContributionEur != null;
  if (!hasFramework) {
    // Legacy path — direct appropriations only, single group → total.
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
          label: `${labels.otherLabel} (${rest.length})`,
          type: "leaf",
          side: "spending",
          valueEur: restSum,
          plannedEur: restSum,
          groupLabel: null,
          ministryNodeId: null,
        });
        links.push({ source: id, target: totalNodeId, valueEur: restSum });
      }
    }
    nodes.push({
      id: totalNodeId,
      label: labels.totalLabel,
      type: "total",
      side: "spending",
      valueEur: year.plannedTotalEur,
      plannedEur: year.plannedTotalEur,
      groupLabel: null,
      ministryNodeId: null,
    });
    return { nodes, links, totalEur: year.plannedTotalEur, totalNodeId };
  }

  // Framework-aware path. Build the three depth-0 groups in order.
  const sectionIIEur = year.plannedSectionIIEur ?? 0;
  const ministrySum =
    top.reduce((a, m) => a + m.plannedEur, 0) +
    rest.reduce((a, m) => a + m.plannedEur, 0);
  const centralBudgetEur = Math.max(0, sectionIIEur - ministrySum);

  // II. Direct (per ministry) ----------------------------------------------
  const directGroupId = "spending-section-ii";
  nodes.push({
    id: directGroupId,
    label: labels.directGroupLabel,
    type: "group",
    side: "spending",
    valueEur: sectionIIEur,
    plannedEur: sectionIIEur,
    groupLabel: null,
    ministryNodeId: null,
  });
  links.push({
    source: directGroupId,
    target: totalNodeId,
    valueEur: sectionIIEur,
  });
  for (const m of top) {
    const id = `spending-ministry-${m.nodeId}`;
    nodes.push({
      id,
      label: lang === "en" && m.nameEn ? m.nameEn : m.nameBg,
      type: "leaf",
      side: "spending",
      valueEur: m.plannedEur,
      plannedEur: m.plannedEur,
      groupLabel: labels.directGroupLabel,
      ministryNodeId: m.nodeId,
    });
    links.push({ source: id, target: directGroupId, valueEur: m.plannedEur });
  }
  if (rest.length > 0) {
    const restSum = rest.reduce((a, m) => a + m.plannedEur, 0);
    if (restSum > 0) {
      const id = "spending-ministry-other";
      nodes.push({
        id,
        label: `${labels.otherLabel} (${rest.length})`,
        type: "leaf",
        side: "spending",
        valueEur: restSum,
        plannedEur: restSum,
        groupLabel: labels.directGroupLabel,
        ministryNodeId: null,
      });
      links.push({ source: id, target: directGroupId, valueEur: restSum });
    }
  }
  if (centralBudgetEur > 0) {
    const id = "spending-central-budget";
    nodes.push({
      id,
      label: labels.centralBudgetLabel,
      type: "leaf",
      side: "spending",
      valueEur: centralBudgetEur,
      plannedEur: centralBudgetEur,
      groupLabel: labels.directGroupLabel,
      ministryNodeId: null,
    });
    links.push({
      source: id,
      target: directGroupId,
      valueEur: centralBudgetEur,
    });
  }

  // III. Transfers (net) ----------------------------------------------------
  const transfersGroupId = "spending-section-iii";
  const transfersTotalEur = year.plannedTransfers!.totalEur;
  nodes.push({
    id: transfersGroupId,
    label: labels.transfersGroupLabel,
    type: "group",
    side: "spending",
    valueEur: transfersTotalEur,
    plannedEur: transfersTotalEur,
    groupLabel: null,
    ministryNodeId: null,
  });
  links.push({
    source: transfersGroupId,
    target: totalNodeId,
    valueEur: transfersTotalEur,
  });
  // Pick depth-1 leaves under the "Предоставени" depth-0 subtotal. These are
  // the headline recipient buckets (Общини, ДОО, НЗОК, EU at NF, EU at ДФЗ).
  // Drop the small "Получени" branch — it's a sub-percent adjustment that
  // already nets into the framework's transfers total and would clutter the
  // visualization.
  const transferLeaves = pickProvidedTransferLeaves(year.plannedTransfers!);
  for (const leaf of transferLeaves) {
    const id = `spending-transfer-${leaf.code}`;
    nodes.push({
      id,
      label:
        lang === "en"
          ? (lookupEn(leaf.labelBg, PLANNED_TRANSFERS_EN) ?? leaf.labelBg)
          : leaf.labelBg,
      type: "leaf",
      side: "spending",
      valueEur: leaf.plannedEur,
      plannedEur: leaf.plannedEur,
      groupLabel: labels.transfersGroupLabel,
      ministryNodeId: null,
    });
    links.push({
      source: id,
      target: transfersGroupId,
      valueEur: leaf.plannedEur,
    });
  }

  // IV. EU contribution -----------------------------------------------------
  const euId = "spending-section-iv";
  const euEur = year.plannedEuContributionEur ?? 0;
  if (euEur > 0) {
    nodes.push({
      id: euId,
      label: labels.euContributionLabel,
      type: "group",
      side: "spending",
      valueEur: euEur,
      plannedEur: euEur,
      groupLabel: null,
      ministryNodeId: null,
    });
    links.push({ source: euId, target: totalNodeId, valueEur: euEur });
    // d3-sankey routes leaves into the depth-1 (group) column; we want EU to
    // sit there alongside the other section groups, not in the leaf column
    // with the ministry leaves. The same trick as the economic-grain EU
    // section: a phantom source feeds the group from the leaf column.
    const phantomId = `${euId}-layout-src`;
    nodes.push({
      id: phantomId,
      label: "",
      type: "leaf",
      side: "spending",
      valueEur: euEur,
      plannedEur: null,
      groupLabel: null,
      ministryNodeId: null,
      isPhantom: true,
    });
    links.push({ source: phantomId, target: euId, valueEur: euEur });
  }

  const totalEur = sectionIIEur + transfersTotalEur + euEur;
  nodes.push({
    id: totalNodeId,
    label: labels.totalLabel,
    type: "total",
    side: "spending",
    valueEur: totalEur,
    plannedEur: totalEur,
    groupLabel: null,
    ministryNodeId: null,
  });
  return { nodes, links, totalEur, totalNodeId };
};

// Extract depth-1 leaves under the "Предоставени трансфери" depth-0 subtotal.
// Walks until the next depth-0 row.
const pickProvidedTransferLeaves = (tree: PlannedTree): PlannedTreeLine[] => {
  const out: PlannedTreeLine[] = [];
  let inProvided = false;
  for (const line of tree.lines) {
    if (line.depth === 0) {
      inProvided = /Предоставени/i.test(line.labelBg);
      continue;
    }
    if (!inProvided) continue;
    if (line.depth === 1 && line.plannedEur > 0) out.push(line);
  }
  return out;
};

export const snapshotToFlowModel = (
  snapshot: KfpSnapshot,
  lang: "bg" | "en",
  totals: {
    revenueLabel: string;
    spendingLabel: string;
  },
): BudgetFlowModel => {
  const revenueSection = snapshot.sections.find((s) => s.series === "revenue");
  const expenditureSection = snapshot.sections.find(
    (s) => s.series === "expenditure",
  );
  const euSection = snapshot.sections.find(
    (s) => s.series === "euContribution",
  );
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

  return {
    fiscalYear: snapshot.fiscalYear,
    asOf: snapshot.asOf,
    currency: snapshot.currency,
    grain: "economic",
    source: "kfp",
    revenue,
    spending,
    balance: {
      revenueEur: revenue.totalEur,
      spendingEur: spending.totalEur,
      balanceEur,
      isDeficit: balanceEur < 0,
    },
  };
};

// Admin-grain model: both sides come from the State Budget Law plan when the
// Чл. 1 framework is ingested for this year. The revenue side renders the
// planned revenue tree (tax breakdown + non-tax + grants); the spending side
// renders all three SBL spending sections (II direct + III transfers + IV EU);
// the balance bridge is the law's own planned deficit/surplus (V = I-II-III-IV).
// When the framework is missing (older years), falls back to the legacy mix:
// КФП-executed revenue vs SBL-planned direct appropriations — known to be
// grain-mismatched but the best we can do without the framework data.
export const snapshotToAdminFlowModel = (
  snapshot: KfpSnapshot,
  adminYear: AdminFlowYear,
  lang: "bg" | "en",
  totals: {
    revenueLabel: string;
    spendingLabel: string;
    otherLabel: string;
    directGroupLabel: string;
    centralBudgetLabel: string;
    transfersGroupLabel: string;
    euContributionLabel: string;
  },
): BudgetFlowModel => {
  let revenue: FlowGraph;
  if (adminYear.plannedRevenue) {
    revenue = buildGraph(
      "revenue",
      plannedRevenueToSection(adminYear.plannedRevenue, PLANNED_REVENUE_EN),
      [],
      totals.revenueLabel,
      lang,
    );
  } else {
    const revenueSection = snapshot.sections.find(
      (s) => s.series === "revenue",
    );
    if (!revenueSection) {
      throw new Error(
        "snapshotToAdminFlowModel: missing revenue section in snapshot",
      );
    }
    revenue = buildGraph(
      "revenue",
      revenueSection,
      [],
      totals.revenueLabel,
      lang,
    );
  }
  const spending = buildAdminSpendingGraph(
    adminYear,
    {
      totalLabel: totals.spendingLabel,
      otherLabel: totals.otherLabel,
      directGroupLabel: totals.directGroupLabel,
      centralBudgetLabel: totals.centralBudgetLabel,
      transfersGroupLabel: totals.transfersGroupLabel,
      euContributionLabel: totals.euContributionLabel,
    },
    lang,
  );
  // Planned balance from the law (V. БЮДЖЕТНО САЛДО) when available; the law
  // defines it as I-II-III-IV which equals revenue.totalEur - spending.totalEur
  // by construction once both sides come from the framework. The arithmetic
  // fallback is for legacy years where the framework is missing.
  const balanceEur =
    adminYear.plannedBalanceEur ?? revenue.totalEur - spending.totalEur;
  return {
    fiscalYear: snapshot.fiscalYear,
    asOf: snapshot.asOf,
    currency: snapshot.currency,
    grain: "admin",
    source: "law",
    revenue,
    spending,
    balance: {
      revenueEur: revenue.totalEur,
      spendingEur: spending.totalEur,
      balanceEur,
      isDeficit: balanceEur < 0,
    },
  };
};
