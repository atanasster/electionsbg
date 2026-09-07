// One cycle's runoff transfer — `<cycle>/runoff_transfer.json`.
//
// ⚠⚠ THE FILE CARRIES ITS OWN CAVEAT AND THIS HOOK REFUSES A FILE WITHOUT ONE. `basis` is the
// sentence saying the matrix is an ESTIMATE — an ecological regression consistent with the
// data, never counted people — and a payload missing it is `unusable` rather than `ready`.
// That is the whole reason the guard is stricter than „has a matrix": a Sankey rendered
// without the caveat publishes individual behaviour inferred from aggregates, and the caveat
// living in the DATA rather than in a translation is what stops a surface from forgetting it.
//
// ⚠ A MISSING FILE IS `absent`, NOT AN ERROR — `usePresidentialSummary`'s rule, for the same
// reason. `data/*_pvr` is gitignored and reaches the bucket only through a sync, so „not
// published yet" is the expected answer for most of this corpus and must not enter React
// Query's retry-and-error path. A cycle DECIDED IN ROUND 1 is also `absent`: the builder
// writes nothing for it, which is correct — there is no transfer to estimate.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { guardedFetch, makeWarnOnce, str } from "./guardedFetch";
import type { VoteFlowMatrix } from "@/data/voteFlows/voteFlowTypes";

/** One oblast's row. ⚠ THE FIRST THREE FIELDS DESCRIBE THE ESTIMATE; the rest are arithmetic
 *  on published protocols. Mixing them in one sentence of copy is the error to avoid. */
export interface RunoffOblast {
  oblast: string;
  sections: number;
  rasResidual: number;
  /** The runoff WINNER's votes, round 1 and round 2. */
  w1: number;
  w2: number;
  /** Round-1 votes for the pairs that did not reach the runoff. */
  elim: number;
  /** Votes for pairs only — „не подкрепям никого“ is `n1`/`n2`. */
  v1: number;
  v2: number;
  /** ⚠ NULL, NOT 0, BEFORE 2016: the ballot did not carry the line. */
  n1: number | null;
  n2: number | null;
  a1: number;
  a2: number;
  /** ⚠ TWO ROLLS, because the commission publishes two. Dividing round 1's turnout by round
   *  2's roll is wrong by up to 6% (Софийска област, 2006). */
  reg1: number;
  reg2: number;
}

export interface RunoffTransfer {
  cycle: string;
  basis: string;
  basisEn: string;
  finalists: { number: number; president: string; votes: number }[];
  national: {
    matrix: VoteFlowMatrix;
    sections: number;
    droppedVotes: number;
    /** The largest relative gap between a node's published total and its drawn ribbons. */
    marginGap: number;
  };
  oblasts: RunoffOblast[];
  coverage: {
    basis: string;
    basisEn: string;
    domesticSections: number;
    abroadVotes: number;
    /** ⚠ SECTIONS WHOSE OBLAST PLACEMENT WAS REFUSED — outside the matrix, like abroad, and on
     *  2011 nine times larger: 1,355 sections / 422,726 votes, all of them Sofia. A surface
     *  that names only `abroadVotes` leaves a reader unable to reconcile the Sankey's node
     *  labels with the published result. Zero on the other four cycles. */
    unplacedSections: number;
    unplacedVotes: number;
    settlementsJoined: number;
    sectionsWithEkatte: number;
    sectionsWithoutEkatte: number;
    votesWithoutEkatte: number;
  };
  residue: {
    round1Only: string[];
    round2Only: string[];
    round1OnlyVotes: number;
    round2OnlyVotes: number;
  };
}

/** ⚠ FOUR STATES, NOT A BOOLEAN — „loading", „no runoff / not published", „published but
 *  unreadable" and „here it is" are four different instructions to a screen. */
export type RunoffTransferState =
  | { status: "loading" }
  | { status: "ready"; transfer: RunoffTransfer }
  | { status: "absent" }
  | { status: "unusable" };

export const isRunoffTransfer = (v: unknown): v is RunoffTransfer => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  // ⚠ BOTH CAVEATS ARE REQUIRED, in both languages. An EN reader of a file carrying only the
  // Bulgarian sentence would get the chart with no caveat at all.
  if (!str(o.basis) || !str(o.basisEn)) return false;
  const nat = o.national as Record<string, unknown> | undefined;
  const matrix = nat?.matrix as Record<string, unknown> | undefined;
  if (
    !Array.isArray(matrix?.fromNodes) ||
    !Array.isArray(matrix?.toNodes) ||
    !Array.isArray(matrix?.flows)
  )
    return false;
  if (!Array.isArray(o.finalists) || o.finalists.length !== 2) return false;
  if (!Array.isArray(o.oblasts)) return false;
  const cov = o.coverage as Record<string, unknown> | undefined;
  return str(cov?.basis) && str(cov?.basisEn);
};

export const runoffTransferPath = (cycle: string): string =>
  `${cycle}/runoff_transfer.json`;

// ⚠ ONE SET PER MODULE, so a broken origin on one artifact cannot silence another's
// first warning. The state machine itself lives in `guardedFetch`.
const { warnOnce, reset } = makeWarnOnce();

/** Test-only: the guard above is module state, so a suite asserting on it needs a way back. */
export const __resetRunoffTransferWarnings = reset;

export const fetchRunoffTransfer = async (
  cycle: string,
): Promise<RunoffTransferState> => {
  const got = await guardedFetch({
    path: runoffTransferPath(cycle),
    id: cycle,
    prefix: "rt",
    subject: "runoff transfer",
    guard: isRunoffTransfer,
    shapeMessage:
      "missing the estimate's caveat or its matrix — refusing to render it",
    warnOnce,
    toUrl: (path) => dataUrl(`/${path}`),
  });
  // ⚠ THE PAYLOAD KEEPS ITS OWN NAME. `transfer` is what every consumer destructures;
  // renaming it to a generic `value` would rewrite five surfaces for no reader's benefit.
  return got.status === "ready"
    ? { status: "ready", transfer: got.value }
    : got;
};

export const useRunoffTransfer = (
  cycle: string | undefined,
): RunoffTransferState => {
  const q = useQuery({
    queryKey: ["presidential_runoff_transfer", cycle ?? ""],
    queryFn: () => fetchRunoffTransfer(cycle as string),
    enabled: !!cycle,
  });
  return q.data ?? { status: "loading" };
};
