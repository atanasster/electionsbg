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
