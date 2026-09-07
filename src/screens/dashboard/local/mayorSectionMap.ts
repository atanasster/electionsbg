// The two inputs a per-station MAYOR map needs, in one place — the legend that colours its dots
// and the per-section field they are read from.
//
// ⚠ EXTRACTED BECAUSE TWO SURFACES NOW DRAW THAT MAP. `LocalElectionScreen` mounts it as a
// tile below the fold, and the election shell's `local/municipality/winner` adapter draws it in
// the canvas beside the ranked result. A second copy of these ten lines is a second answer to
// „what colour is this candidate", and the two would diverge first on the cases nobody clicks:
// an independent with no canonical party, a local-only list, a Sofia район.
//
// ⚠ THE NEUTRAL IS NOT A PARTY COLOUR AND MUST NOT BECOME ONE. A candidate with no
// `primaryCanonicalId` is an independent or a local-only list; borrowing a party's colour for
// one would state an affiliation the corpus does not record, on a named person.

import type { LocalMayorResult } from "@/data/local/types";

/** ⚠ THE SAME GREY THE REST OF THE LOCAL MAPS USE for „no party to inherit from". */
export const MAYOR_LEGEND_NEUTRAL = "#9ca3af";

export type MayorLegend = Map<number, { name: string; color: string }>;

/** ⚠ KEYED ON `localPartyNum`, WHICH IS THE BALLOT NUMBER — the same key
 *  `LocalSectionResult.mayorVotes[].localPartyNum` carries. Keying on a canonical party id
 *  instead would collapse two candidates nominated by one party onto one colour, and a
 *  by-election's candidates carry no canonical id at all. */
export const mayorSectionLegend = (
  candidates: readonly LocalMayorResult[],
  colorFor: (canonicalId: string) => string | undefined,
): MayorLegend => {
  const legend: MayorLegend = new Map();
  for (const c of candidates)
    legend.set(c.localPartyNum, {
      name: c.candidateName,
      color: c.primaryCanonicalId
        ? (colorFor(c.primaryCanonicalId) ?? MAYOR_LEGEND_NEUTRAL)
        : MAYOR_LEGEND_NEUTRAL,
    });
  return legend;
};

/** Which per-section field holds this place's mayoral votes.
 *
 *  ⚠ A РАЙОН READS ITS OWN BALLOT (КР), NOT THE CITY'S (КО). Пловдив's and Варна's районы —
 *  and Sofia's — elect a районен кмет on a separate ballot; reading `mayorVotes` there plots
 *  the parent city's mayoral race on the район's own stations, which is a different election. */
export const mayorVoteFieldFor = (
  isRayon: boolean,
): "mayorVotes" | "rayonMayorVotes" =>
  isRayon ? "rayonMayorVotes" : "mayorVotes";
