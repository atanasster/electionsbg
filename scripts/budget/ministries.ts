// Per-ministry rollup builder.
//
// The ministry detail screen needs, for one spending unit: its per-year
// revenue / expenditure / balance, its per-year program budget, and its
// procurement footprint. Rather than have the screen fetch every year's
// whole-corpus reconciliation files (~320 KB to render ten rows), the pipeline
// pre-slices one self-contained ministries/<nodeId>.json per unit (~1–3 KB).

import type {
  ClassificationRegistry,
  MinistryProcurementFile,
  MinistryRollup,
  MinistryRollupYear,
  MinistrySeriesExecution,
  Money,
  ReconciliationRow,
} from "./types";

// Build one self-contained rollup per admin (spending-unit) node.
export const buildMinistryRollups = (
  adminRegistry: ClassificationRegistry,
  adminReconByYear: Map<number, ReconciliationRow[]>,
  programRegistry: ClassificationRegistry,
  programReconByYear: Map<number, ReconciliationRow[]>,
  ministryProcurement: MinistryProcurementFile,
): MinistryRollup[] => {
  // program node id → owning admin node id
  const programOwner = new Map<string, string>();
  for (const node of programRegistry.nodes) {
    if (node.ownerAdminId) programOwner.set(node.id, node.ownerAdminId);
  }
  const procByNode = new Map(
    ministryProcurement.entries.map((e) => [e.nodeId, e]),
  );
  const years = [
    ...new Set([...adminReconByYear.keys(), ...programReconByYear.keys()]),
  ].sort((a, b) => a - b);

  const rollups: MinistryRollup[] = [];
  for (const node of adminRegistry.nodes) {
    const rollupYears: MinistryRollupYear[] = [];
    for (const year of years) {
      const adminRows = (adminReconByYear.get(year) ?? []).filter(
        (r) => r.nodeId === node.id,
      );
      const pick = (kind: string): Money | null =>
        adminRows.find((r) => r.kind === kind)?.planned ?? null;
      // Pull the execution side (amended / executed / variance) from the same
      // reconciliation row, when it exists for this unit/year.
      const pickExec = (kind: string): MinistrySeriesExecution | null => {
        const row = adminRows.find((r) => r.kind === kind);
        if (!row || !row.executed) return null;
        return {
          amended: row.amended,
          executed: row.executed,
          varianceEur: row.varianceEur,
          variancePct: row.variancePct,
        };
      };
      const revenueExec = pickExec("revenue");
      const expenditureExec = pickExec("expenditure");
      const execution =
        revenueExec || expenditureExec
          ? { revenue: revenueExec, expenditure: expenditureExec }
          : null;
      const programs = (programReconByYear.get(year) ?? [])
        .filter((r) => programOwner.get(r.nodeId) === node.id)
        .map((r) => ({
          nodeId: r.nodeId,
          nameBg: r.nodeNameBg,
          nameEn: r.nodeNameEn,
          planned: r.planned,
          // execution joined from the отчет (name-matched in
          // buildExecutionFacts); null when only law data exists for this
          // (year, program) pair.
          execution:
            r.executed || r.amended
              ? {
                  amended: r.amended,
                  executed: r.executed,
                  varianceEur: r.varianceEur,
                  variancePct: r.variancePct,
                }
              : null,
        }))
        .sort(
          (a, b) => (b.planned?.amountEur ?? 0) - (a.planned?.amountEur ?? 0),
        );
      if (adminRows.length === 0 && programs.length === 0) continue;
      rollupYears.push({
        fiscalYear: year,
        revenue: pick("revenue"),
        expenditure: pick("expenditure"),
        balance: pick("balance"),
        execution,
        programs,
      });
    }
    const procurement = procByNode.get(node.id) ?? null;
    if (rollupYears.length === 0 && !procurement) continue;
    rollups.push({
      nodeId: node.id,
      nameBg: node.nameBg,
      nameEn: node.nameEn,
      eik: node.eik ?? null,
      years: rollupYears,
      procurement,
    });
  }
  return rollups;
};
