// Estimated voter-flow ("Where did the votes go") data types. Produced by
// scripts/voteFlows offline and consumed by the SPA. Estimates come from a
// non-negative-least-squares Goodman ecological regression per oblast,
// followed by RAS scaling so row/column sums match the published vote
// totals exactly. See VoteFlowMethodologyScreen for the full assumptions.
//
// The two ends of every cycle pair carry the same "out-of-electorate"
// pseudo-nodes so the Sankey conserves the registered-voter pool:
//
//   from side                       to side
//   ─────────                       ───────
//   abstain    (didn't vote in T)   abstain    (didn't vote in T+1)
//   removed    (rolls shrank)       (none — these voters are gone)
//   (none)     (new on rolls)       added      (rolls grew / 18-yr-olds)
//
// Either `removed` or `added` is populated for a given cycle pair, never
// both — pipeline picks based on the sign of the registered-voter delta.

export type VoteFlowNodeId = string;

export type VoteFlowNode = {
  id: VoteFlowNodeId;
  /** Bulgarian display label. */
  label: string;
  /** English display label. */
  labelEn: string;
  color: string;
  /** Total votes attributed to this node in its cycle (the marginal total).
   * For the "abstain"/"added"/"removed" pseudo-nodes this is the count of
   * registered voters in the corresponding bucket. */
  votes: number;
  /** True for synthetic non-party nodes (abstain/added/removed/small). */
  pseudo?: boolean;
};

export type VoteFlowEdge = {
  /** Source node id (from-cycle node). */
  from: VoteFlowNodeId;
  /** Target node id (to-cycle node). */
  to: VoteFlowNodeId;
  /** Estimated number of voters flowing from → to. */
  votes: number;
};

export type VoteFlowMatrix = {
  /** Source-side (from cycle T) node list, ordered as the Sankey draws them. */
  fromNodes: VoteFlowNode[];
  /** Target-side (to cycle T+1) node list. */
  toNodes: VoteFlowNode[];
  flows: VoteFlowEdge[];
};

export type VoteFlowDiagnostics = {
  sectionsMatched: number;
  sectionsDropped: number;
  /** Sum of row sums (≈ to-cycle electorate). */
  totalElectorateFrom: number;
  totalElectorateTo: number;
  /** RAS biproportional scaling iterations until convergence. */
  rasIterations: number;
  /** L1 mass-balance residual after RAS, normalised by total electorate. */
  rasResidual: number;
};

/** One scope of a cycle-pair's flows. Files are split per scope so the
 * client only fetches what it actually renders:
 *
 *   /transitions/<from>_<to>/national.json  — national rollup (~12KB)
 *   /transitions/<from>_<to>/<mir>.json     — single oblast (~8KB each)
 *
 * Diagnostics live on the national file only — they describe the
 * pipeline run and are not oblast-specific. */
export type VoteFlowScopeFile = {
  from: string;
  to: string;
  /** "national" or 2-digit MIR code ("01"…"31"). */
  scope: string;
  matrix: VoteFlowMatrix;
  diagnostics?: VoteFlowDiagnostics;
};

/** Index of available cycle pairs, written once to /transitions/index.json
 * so the screen can populate its picker without trying every pair. */
export type VoteFlowIndex = {
  pairs: { from: string; to: string }[];
  generatedAt: string;
};
