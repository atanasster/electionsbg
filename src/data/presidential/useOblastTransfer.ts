// One oblast's runoff transfer — `<cycle>/runoff_transfer/<oblast>.json`.
//
// ⚠⚠ THE SAME REFUSAL AS `useRunoffTransfer`, AND FOR A STRICTER REASON. A shard carries the
// estimate's caveat AND the coverage refusal verbatim, because a region page fetches this file
// and nothing else — there is no cycle file in the document to fall back on. So a payload
// missing either sentence is `unusable` rather than `ready`, and „the chart rendered" implies
// „both caveats rendered". On 2011 the second one is the larger of the two: the ingest refused
// to place 1,355 sections / 422,726 runoff votes, all of them Sofia, against 32,024 votes
// inside Sofia's three shards.
//
// ⚠ A MISSING FILE IS `absent`, NOT AN ERROR — `useRunoffTransfer`'s rule. `data/*_pvr` is
// gitignored and reaches the bucket only through `bucket:gz`, and a cycle decided in round 1
// has no shards at all, so „not published" is an ordinary answer and must not enter React
// Query's retry-and-error path.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { VoteFlowMatrix } from "@/data/voteFlows/voteFlowTypes";

export interface OblastTransfer {
  cycle: string;
  oblast: string;
  basis: string;
  basisEn: string;
  /** The runoff pair, WINNER FIRST — the NATIONAL winner, with this oblast's own round-2
   *  votes. ⚠ NOT RE-RANKED LOCALLY: „winner" is a fact about the runoff, and eleven oblasts
   *  went the other way in 2011. */
  finalists: { number: number; president: string; votes: number }[];
  /** Sections in this oblast that opened in both rounds. */
  sections: number;
  coverage: {
    basis: string;
    basisEn: string;
    /** ⚠ CYCLE-WIDE, NOT THIS OBLAST'S. The placement-refused shard carries no oblast by
     *  construction — that is what „unplaced" means — so the mass cannot be attributed to
     *  one, which is exactly why a surface that omits it invites a reader to assume the
     *  shard is complete. */
    unplacedSectionsInCycle: number;
    unplacedVotesInCycle: number;
    abroadVotesInCycle: number;
  };
  matrix: VoteFlowMatrix;
  droppedVotes: number;
  /** ⚠ AN ORDER OF MAGNITUDE WORSE THAN THE NATIONAL FIGURE — median 0.09 and up to 0.70
   *  across the 155 shards, against 0.012-0.047 nationally, because the RAS residual cancels
   *  when 31 oblasts are summed and does not cancel inside one. A surface that prints a node's
   *  total beside its ribbons owes the reader this number. */
  marginGap: number;
  rasResidual: number;
}

/** ⚠ FOUR STATES, NOT A BOOLEAN — the same four `useRunoffTransfer` returns, for the same
 *  reason: „not published yet" and „published but unreadable" are different instructions. */
export type OblastTransferState =
  | { status: "loading" }
  | { status: "ready"; transfer: OblastTransfer }
  | { status: "absent" }
  | { status: "unusable" };

const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export const isOblastTransfer = (v: unknown): v is OblastTransfer => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  // ⚠ BOTH CAVEATS, IN BOTH LANGUAGES, AND BOTH KINDS. An EN reader of a file carrying only
  // the Bulgarian sentence gets the chart with no caveat at all; a reader of a file carrying
  // only `basis` gets the estimate's qualification and not the coverage refusal.
  if (!str(o.basis) || !str(o.basisEn)) return false;
  const cov = o.coverage as Record<string, unknown> | undefined;
  if (!str(cov?.basis) || !str(cov?.basisEn)) return false;
  const matrix = o.matrix as Record<string, unknown> | undefined;
  if (
    !Array.isArray(matrix?.fromNodes) ||
    !Array.isArray(matrix?.toNodes) ||
    !Array.isArray(matrix?.flows)
  )
    return false;
  return Array.isArray(o.finalists) && o.finalists.length === 2;
};

/** ⚠ ONE PLACE THE LAYOUT IS SPELLED on this side, matching `oblastTransferFile` in
 *  `build_runoff_transfer.ts`. A second literal is a page requesting a file nobody wrote —
 *  and since a 404 is `absent` by design, it would be a tile that silently never appears. */
export const oblastTransferPath = (cycle: string, oblast: string): string =>
  `${cycle}/runoff_transfer/${oblast}.json`;
// ⚠ NOT `encodeURIComponent`, AND THAT IS THE FAMILY'S CONVENTION RATHER THAN AN OVERSIGHT —
// no hook under `src/data/presidential/` or `src/data/elections/` encodes a route param, so
// encoding here alone would make this the odd one out AND break the producer/browser path pin
// unless both sides changed together. The exposure is close to nil: the target is a public,
// read-only bucket, no credentials are attached, and whatever comes back must satisfy
// `isOblastTransfer` before anything renders. Worth doing for the family in its own pass.

const logged = new Set<string>();
/** ⚠ ONCE PER PROCESS PER REASON — `useRunoffTransfer`'s rule. „Not published" is expected and
 *  „malformed" is a defect, and a per-render warning is a log nobody reads. */
const warnOnce = (key: string, message: string): void => {
  if (logged.has(key)) return;
  logged.add(key);
  console.warn(message);
};

/** Test-only: the guard above is module state, so a suite asserting on it needs a way back. */
export const __resetOblastTransferWarnings = (): void => logged.clear();

export const fetchOblastTransfer = async (
  cycle: string,
  oblast: string,
): Promise<OblastTransferState> => {
  const id = `${cycle}/${oblast}`;
  let res: Response;
  try {
    res = await fetch(dataUrl(`/${oblastTransferPath(cycle, oblast)}`));
  } catch (e) {
    // ⚠ A REJECTED FETCH LOOKS EXACTLY LIKE ROUTINE ABSENCE — a CORS misconfiguration on the
    // data bucket takes every oblast out at once, and uncaught it reaches the reader as „this
    // oblast has no runoff estimate".
    warnOnce(`ot:net:${id}`, `oblast transfer ${id}: fetch failed (${e})`);
    return { status: "unusable" };
  }
  if (res.status === 404) return { status: "absent" };
  if (!res.ok) {
    warnOnce(`ot:http:${id}`, `oblast transfer ${id}: HTTP ${res.status}`);
    return { status: "unusable" };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    warnOnce(`ot:json:${id}`, `oblast transfer ${id}: not JSON`);
    return { status: "unusable" };
  }
  if (!isOblastTransfer(body)) {
    warnOnce(
      `ot:shape:${id}`,
      `oblast transfer ${id}: missing the estimate's caveat, the coverage refusal or its matrix — refusing to render it`,
    );
    return { status: "unusable" };
  }
  return { status: "ready", transfer: body };
};

export const useOblastTransfer = (
  cycle: string | undefined,
  oblast: string | undefined,
): OblastTransferState => {
  const q = useQuery({
    queryKey: ["presidential_oblast_transfer", cycle ?? "", oblast ?? ""],
    queryFn: () => fetchOblastTransfer(cycle as string, oblast as string),
    enabled: !!cycle && !!oblast,
  });
  return q.data ?? { status: "loading" };
};
