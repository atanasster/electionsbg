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
      const programs = (programReconByYear.get(year) ?? [])
        .filter((r) => programOwner.get(r.nodeId) === node.id)
        .map((r) => ({
          nodeId: r.nodeId,
          nameBg: r.nodeNameBg,
          nameEn: r.nodeNameEn,
          planned: r.planned,
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
