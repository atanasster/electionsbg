// Reconciliation builder — joins the budget journey (law → amendments →
// execution) into one row per classification node, per kind, per fiscal year.
//
// This increment covers the `admin` dimension from the State Budget Law only:
// `planned` comes from the law facts; `executed` is null because the КФП
// execution feed carries no ministry breakdown (ministry-level execution lives
// in the year-end execution report — a later increment). `completeness` is
// "missing" accordingly — the frontend renders these as plan-only rows rather
// than implying a variance that the data can't support.

import type {
  BudgetFact,
  ClassificationRegistry,
  ReconciliationRow,
} from "./types";

const nodeName = (
  registry: ClassificationRegistry,
  nodeId: string,
): { nameBg: string; nameEn: string } => {
  const node = registry.nodes.find((n) => n.id === nodeId);
  return {
    nameBg: node?.nameBg ?? nodeId,
    nameEn: node?.nameEn || (node?.nameBg ?? nodeId),
  };
};

// Build the admin-dimension reconciliation rows for one fiscal year from its
// law facts. One row per (admin node, kind).
export const buildAdminReconciliation = (
  fiscalYear: number,
  lawFacts: BudgetFact[],
  registry: ClassificationRegistry,
): ReconciliationRow[] => {
  const rows: ReconciliationRow[] = [];
  for (const fact of lawFacts) {
    const nodeId = fact.classification.admin;
    if (!nodeId || !fact.grain.includes("admin")) continue;
    const { nameBg, nameEn } = nodeName(registry, nodeId);
    rows.push({
      fiscalYear,
      dimension: "admin",
      nodeId,
      nodeNameBg: nameBg,
      nodeNameEn: nameEn,
      kind: fact.kind,
      planned: fact.money,
      amendmentTrail: [],
      amended: null,
      executed: null,
      varianceEur: null,
      variancePct: null,
      // The law sets the plan; ministry-grain execution is not yet available.
      completeness: "missing",
    });
  }
  return rows.sort((a, b) =>
    a.nodeId === b.nodeId
      ? a.kind.localeCompare(b.kind)
      : a.nodeId.localeCompare(b.nodeId),
  );
};

// Build the economic-dimension reconciliation for one fiscal year. The egov
// feed carries both a plan ("Закон") and an execution ("Изпълнение") column,
// so — for a complete year — every economic node gets a real plan-vs-actual
// pair and a computed variance. `completeness` is "exact" when both stages are
// present, "missing" when one is absent (e.g. the post-euro 2026 feed has no
// plan column).
export const buildEconomicReconciliation = (
  fiscalYear: number,
  economicFacts: BudgetFact[],
  registry: ClassificationRegistry,
): ReconciliationRow[] => {
  // Group the law + execution facts by (economic node, kind).
  const groups = new Map<
    string,
    {
      nodeId: string;
      kind: BudgetFact["kind"];
      planned: BudgetFact["money"] | null;
      executed: BudgetFact["money"] | null;
    }
  >();
  for (const fact of economicFacts) {
    const nodeId = fact.classification.economic;
    if (!nodeId || !fact.grain.includes("economic")) continue;
    const key = `${nodeId}|${fact.kind}`;
    let g = groups.get(key);
    if (!g) {
      g = { nodeId, kind: fact.kind, planned: null, executed: null };
      groups.set(key, g);
    }
    if (fact.version.stage === "law") g.planned = fact.money;
    if (fact.version.stage === "execution") g.executed = fact.money;
  }

  const rows: ReconciliationRow[] = [];
  for (const g of groups.values()) {
    const { nameBg, nameEn } = nodeName(registry, g.nodeId);
    const varianceEur =
      g.planned && g.executed
        ? g.executed.amountEur - g.planned.amountEur
        : null;
    const variancePct =
      varianceEur != null && g.planned && g.planned.amountEur !== 0
        ? (varianceEur / Math.abs(g.planned.amountEur)) * 100
        : null;
    rows.push({
      fiscalYear,
      dimension: "economic",
      nodeId: g.nodeId,
      nodeNameBg: nameBg,
      nodeNameEn: nameEn,
      kind: g.kind,
      planned: g.planned,
      amendmentTrail: [],
      amended: null,
      executed: g.executed,
      varianceEur,
      variancePct,
      completeness: g.planned && g.executed ? "exact" : "missing",
    });
  }
  return rows.sort((a, b) =>
    a.nodeId === b.nodeId
      ? a.kind.localeCompare(b.kind)
      : a.nodeId.localeCompare(b.nodeId),
  );
};
