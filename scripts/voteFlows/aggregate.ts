// Aggregate per-oblast flow matrices to a national matrix and serialize
// the cycle-pair as a directory of per-scope JSON files. Splitting per
// scope is a load-time optimisation: the home dashboard fetches only the
// national matrix (~12KB), an oblast view fetches only that oblast (~8KB),
// and the Sofia dashboard fetches its three MIRs in parallel — instead of
// every consumer downloading the combined ~436KB file containing 30+
// oblasts they don't need.

import {
  VoteFlowEdge,
  VoteFlowMatrix,
  VoteFlowNode,
  VoteFlowScopeFile,
  VoteFlowDiagnostics,
} from "@/data/voteFlows/voteFlowTypes";
import { ReconcileResult } from "./reconcile";
import { OblastEstimate } from "./estimate";

const buildMatrix = ({
  fromIds,
  toIds,
  fromTotals,
  toTotals,
  flows,
  labels,
}: {
  fromIds: string[];
  toIds: string[];
  fromTotals: number[];
  toTotals: number[];
  flows: number[][];
  labels: ReconcileResult["labels"];
}): VoteFlowMatrix => {
  const isPseudo = (id: string) => id.startsWith("__");
  const fromNodes: VoteFlowNode[] = fromIds.map((id, i) => ({
    id,
    label: labels[id]?.bg ?? id,
    labelEn: labels[id]?.en ?? id,
    color: labels[id]?.color ?? "#888888",
    votes: Math.round(fromTotals[i]),
    pseudo: isPseudo(id) || undefined,
  }));
  const toNodes: VoteFlowNode[] = toIds.map((id, i) => ({
    id,
    label: labels[id]?.bg ?? id,
    labelEn: labels[id]?.en ?? id,
    color: labels[id]?.color ?? "#888888",
    votes: Math.round(toTotals[i]),
    pseudo: isPseudo(id) || undefined,
  }));
  const edges: VoteFlowEdge[] = [];
  // Drop edges below an absolute threshold (≈0.005% of total mass) —
  // they clutter the chart without changing the picture. Threshold is
  // tight enough that aggregate row sums stay within ~0.5% of node
  // targets, so per-node "X% of voters went to..." is reliable.
  const totalMass = fromTotals.reduce((s, n) => s + n, 0);
  const minEdgeVotes = Math.max(20, totalMass * 0.00005);
  for (let i = 0; i < fromIds.length; i += 1) {
    for (let j = 0; j < toIds.length; j += 1) {
      const v = flows[i]?.[j] ?? 0;
      if (v >= minEdgeVotes) {
        edges.push({
          from: fromIds[i],
          to: toIds[j],
          votes: Math.round(v),
        });
      }
    }
  }
  return { fromNodes, toNodes, flows: edges };
};

/** Build the per-scope files for a cycle pair. Returns a map of
 * `<scope> → file payload`, where `scope` is "national" or a 2-digit
 * oblast/MIR code, ready for the caller to serialize independently. */
export const buildVoteFlowScopeFiles = ({
  fromDate,
  toDate,
  reconcile,
  estimates,
}: {
  fromDate: string;
  toDate: string;
  reconcile: ReconcileResult;
  estimates: OblastEstimate[];
}): Record<string, VoteFlowScopeFile> => {
  const { fromIds, toIds, labels } = reconcile;
  const R = fromIds.length;
  const C = toIds.length;

  const nationalFlows: number[][] = Array.from({ length: R }, () =>
    new Array<number>(C).fill(0),
  );
  const nationalFromTotals = new Array<number>(R).fill(0);
  const nationalToTotals = new Array<number>(C).fill(0);
  for (const est of estimates) {
    for (let i = 0; i < R; i += 1) {
      for (let j = 0; j < C; j += 1) nationalFlows[i][j] += est.flows[i][j];
    }
    const ob = reconcile.byOblast[est.oblast];
    if (!ob) continue;
    for (let i = 0; i < R; i += 1) nationalFromTotals[i] += ob.fromTotals[i];
    for (let j = 0; j < C; j += 1) nationalToTotals[j] += ob.toTotals[j];
  }

  const national: VoteFlowMatrix = buildMatrix({
    fromIds,
    toIds,
    fromTotals: nationalFromTotals,
    toTotals: nationalToTotals,
    flows: nationalFlows,
    labels,
  });

  // Average residual weighted by oblast mass.
  let weightedResid = 0;
  let weightSum = 0;
  let totalIter = 0;
  for (const est of estimates) {
    const ob = reconcile.byOblast[est.oblast];
    const w = ob ? ob.fromTotals.reduce((s, n) => s + n, 0) : 0;
    weightedResid += est.rasResidual * w;
    weightSum += w;
    totalIter = Math.max(totalIter, est.rasIterations);
  }
  const diagnostics: VoteFlowDiagnostics = {
    sectionsMatched: reconcile.diagnostics.sectionsMatched,
    sectionsDropped: reconcile.diagnostics.sectionsDropped,
    totalElectorateFrom: reconcile.diagnostics.totalRegisteredFrom,
    totalElectorateTo: reconcile.diagnostics.totalRegisteredTo,
    rasIterations: totalIter,
    rasResidual: weightSum > 0 ? weightedResid / weightSum : 0,
  };

  const out: Record<string, VoteFlowScopeFile> = {
    national: {
      from: fromDate,
      to: toDate,
      scope: "national",
      matrix: national,
      diagnostics,
    },
  };
  for (const est of estimates) {
    const ob = reconcile.byOblast[est.oblast];
    if (!ob) continue;
    out[est.oblast] = {
      from: fromDate,
      to: toDate,
      scope: est.oblast,
      matrix: buildMatrix({
        fromIds,
        toIds,
        fromTotals: ob.fromTotals,
        toTotals: ob.toTotals,
        flows: est.flows,
        labels,
      }),
    };
  }
  return out;
};
