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
  VoteFlowPersistence,
  VoteFlowScopeFile,
  VoteFlowDiagnostics,
} from "@/data/voteFlows/voteFlowTypes";
import { ReconcileResult } from "./reconcile";
import { OblastEstimate } from "./estimate";

// Voter persistence — see VoteFlowPersistence comment in voteFlowTypes.ts.
// Computed directly from the dense flow matrix (before edge thresholding)
// so small-but-real flows still contribute to the stay-rate denominator.
const computePersistence = ({
  fromIds,
  toIds,
  flows,
}: {
  fromIds: string[];
  toIds: string[];
  flows: number[][];
}): VoteFlowPersistence => {
  const isReal = (id: string) => !id.startsWith("__");
  let stayed = 0;
  let votedBothNamed = 0;
  let topDef:
    | { fromId: string; toId: string; votes: number; fromOutflow: number }
    | undefined;
  // Track total outflow per from-party so we can express the top defection
  // as a share of that party's voters.
  const fromOutflow = new Map<string, number>();
  for (let i = 0; i < fromIds.length; i += 1) {
    if (!isReal(fromIds[i])) continue;
    for (let j = 0; j < toIds.length; j += 1) {
      if (!isReal(toIds[j])) continue;
      fromOutflow.set(
        fromIds[i],
        (fromOutflow.get(fromIds[i]) ?? 0) + flows[i][j],
      );
    }
  }
  for (let i = 0; i < fromIds.length; i += 1) {
    if (!isReal(fromIds[i])) continue;
    for (let j = 0; j < toIds.length; j += 1) {
      if (!isReal(toIds[j])) continue;
      const v = flows[i][j];
      votedBothNamed += v;
      if (fromIds[i] === toIds[j]) {
        stayed += v;
      } else if (!topDef || v > topDef.votes) {
        topDef = {
          fromId: fromIds[i],
          toId: toIds[j],
          votes: v,
          fromOutflow: fromOutflow.get(fromIds[i]) ?? 0,
        };
      }
    }
  }
  const persistence: VoteFlowPersistence = {
    stayedVotes: Math.round(stayed),
    votedBothNamed: Math.round(votedBothNamed),
    stayRate: votedBothNamed > 0 ? stayed / votedBothNamed : 0,
  };
  if (topDef && topDef.fromOutflow > 0) {
    persistence.topDefection = {
      fromId: topDef.fromId,
      toId: topDef.toId,
      votes: Math.round(topDef.votes),
      share: topDef.votes / topDef.fromOutflow,
    };
  }
  return persistence;
};

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
      persistence: computePersistence({
        fromIds,
        toIds,
        flows: nationalFlows,
      }),
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
      persistence: computePersistence({
        fromIds,
        toIds,
        flows: est.flows,
      }),
    };
  }
  return out;
};
