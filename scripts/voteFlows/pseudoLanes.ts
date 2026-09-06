// The synthetic lanes every vote-flow producer shares.
//
// ⚠ IDS START WITH `__`, AND THAT PREFIX IS A CONTRACT. `VoteFlowSankey` and
// `voteFlows/aggregate.ts` both derive „is this a real contestant" from `id.startsWith("__")`,
// so a lane named otherwise is drawn as somebody who stood for office.
//
// ⚠ ONE DECLARATION, BECAUSE FOUR PRODUCERS DRAW ONE CHART. `reconcile.ts`,
// `reconcile_local.ts`, `reconcile_parl_local.ts` and the presidential
// `build_runoff_transfer.ts` all emit an abstain lane into the same renderer; four copies of
// the label and the colour meant „the same lane, the same colour" was a comment rather than a
// fact, and a reader comparing two charts would have had no way to know it had drifted.

/** „Did not vote" — present on BOTH sides of every matrix in this family. */
export const ABSTAIN_ID = "__abstain__";

/** ⚠ THE CHART'S OWN GREY, never another contestant's colour, for a node whose producer could
 *  not resolve one. */
export const FALLBACK_NODE_COLOR = "#888888";

export const ABSTAIN_LANE = {
  bg: "Не гласували",
  en: "Did not vote",
  color: "#cbd5e1", // slate-300
} as const;
