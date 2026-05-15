// Reconciliation builder — joins the budget journey (law → amendments →
// execution) into one row per classification node, per kind, per fiscal year.
//
// `admin` dimension: `planned` comes from the State Budget Law (law_html.ts);
// `amended` (уточнен план) and `executed` (отчет) come from per-ministry
// program-budget execution reports (execution_pdf.ts), where available. For a
// ministry without an ingested execution report yet, the row keeps planned
// only — `completeness: "missing"` — so the frontend renders it as plan-only
// rather than implying a variance the data cannot support.

import type {
  BudgetFact,
  ClassificationRegistry,
  FactKind,
  Money,
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

// Build the admin-dimension reconciliation rows for one fiscal year. Joins
// law facts (planned) with execution-report facts (amended + executed) by
// (admin node, kind). A ministry with no execution report yet still appears,
// plan-only.
export const buildAdminReconciliation = (
  fiscalYear: number,
  lawFacts: BudgetFact[],
  executionFacts: BudgetFact[],
  registry: ClassificationRegistry,
): ReconciliationRow[] => {
  interface Group {
    nodeId: string;
    kind: FactKind;
    planned: Money | null;
    amended: Money | null;
    executed: Money | null;
    amendmentTrail: Array<{ seq: number; effectiveDate: string; money: Money }>;
  }
  const groups = new Map<string, Group>();
  const groupOf = (fact: BudgetFact): Group | null => {
    const adminId = fact.classification.admin;
    if (!adminId || !fact.grain.includes("admin")) return null;
    const key = `${adminId}|${fact.kind}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        nodeId: adminId,
        kind: fact.kind,
        planned: null,
        amended: null,
        executed: null,
        amendmentTrail: [],
      };
      groups.set(key, g);
    }
    return g;
  };

  for (const fact of lawFacts) {
    if (fact.version.stage !== "law") continue;
    const g = groupOf(fact);
    if (g) g.planned = fact.money;
  }
  for (const fact of executionFacts) {
    const g = groupOf(fact);
    if (!g) continue;
    if (fact.version.stage === "law") {
      // The отчет's own "Закон" column restates the appropriation at the
      // отчет's (often consolidated) scope, matching amended + executed. We
      // prefer it over law_html.ts's State-Budget-Law value when present so
      // the law→amended→executed trail is like-with-like (see the comment in
      // execution_facts.ts for the rationale + the МОСВ example).
      g.planned = fact.money;
    } else if (fact.version.stage === "amendment") {
      g.amendmentTrail.push({
        seq: fact.version.seq,
        effectiveDate: fact.version.effectiveDate,
        money: fact.money,
      });
    } else if (fact.version.stage === "execution") {
      g.executed = fact.money;
    }
  }
  // After collecting amendments, `amended` is the highest-seq entry's money
  // (the cumulative уточнен план). The trail itself preserves any sub-steps.
  for (const g of groups.values()) {
    g.amendmentTrail.sort((a, b) => a.seq - b.seq);
    const last = g.amendmentTrail[g.amendmentTrail.length - 1];
    if (last) g.amended = last.money;
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
      dimension: "admin",
      nodeId: g.nodeId,
      nodeNameBg: nameBg,
      nodeNameEn: nameEn,
      kind: g.kind,
      planned: g.planned,
      amendmentTrail: g.amendmentTrail,
      amended: g.amended,
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

// Build the program-dimension reconciliation for one fiscal year. Joins
// law program-grain facts (planned) with execution-report program-grain
// facts (amended + executed) by (program node, kind). Matches the admin
// reconciliation pattern: planned from the law, amended/executed from the
// отчет via the name-based crosswalk in buildExecutionFacts.
export const buildProgramReconciliation = (
  fiscalYear: number,
  lawFacts: BudgetFact[],
  executionFacts: BudgetFact[],
  registry: ClassificationRegistry,
): ReconciliationRow[] => {
  interface Group {
    nodeId: string;
    kind: FactKind;
    planned: Money | null;
    amended: Money | null;
    executed: Money | null;
    amendmentTrail: Array<{ seq: number; effectiveDate: string; money: Money }>;
  }
  const groups = new Map<string, Group>();
  const groupOf = (fact: BudgetFact): Group | null => {
    const nodeId = fact.classification.program;
    if (!nodeId || !fact.grain.includes("program")) return null;
    const key = `${nodeId}|${fact.kind}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        nodeId,
        kind: fact.kind,
        planned: null,
        amended: null,
        executed: null,
        amendmentTrail: [],
      };
      groups.set(key, g);
    }
    return g;
  };

  for (const fact of lawFacts) {
    if (fact.version.stage !== "law") continue;
    const g = groupOf(fact);
    if (g) g.planned = fact.money;
  }
  for (const fact of executionFacts) {
    const g = groupOf(fact);
    if (!g) continue;
    if (fact.version.stage === "law") {
      // Prefer the отчет's restated law for like-with-like scope, same as the
      // admin reconciler.
      g.planned = fact.money;
    } else if (fact.version.stage === "amendment") {
      g.amendmentTrail.push({
        seq: fact.version.seq,
        effectiveDate: fact.version.effectiveDate,
        money: fact.money,
      });
    } else if (fact.version.stage === "execution") {
      g.executed = fact.money;
    }
  }
  for (const g of groups.values()) {
    g.amendmentTrail.sort((a, b) => a.seq - b.seq);
    const last = g.amendmentTrail[g.amendmentTrail.length - 1];
    if (last) g.amended = last.money;
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
      dimension: "program",
      nodeId: g.nodeId,
      nodeNameBg: nameBg,
      nodeNameEn: nameEn,
      kind: g.kind,
      planned: g.planned,
      amendmentTrail: g.amendmentTrail,
      amended: g.amended,
      executed: g.executed,
      varianceEur,
      variancePct,
      completeness: g.planned && g.executed ? "exact" : "missing",
    });
  }
  return rows.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
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
