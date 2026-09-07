// The one way a flagged settlement is named, on either dashboard.
//
// ⚠ WHY IT IS SHARED. `SuspiciousSectionsTile` (`/parliamentary`) and
// `PresidentialSuspiciousTile` (`/presidential/:cycle`) render rows of the SAME producer type
// — `SuspiciousTopSettlement`, emitted by `scripts/reports/suspiciousSections.ts` and by
// `build_suspicious.ts` — so a village flagged on both ballots must read identically on both
// pages. Written twice, the presidential copy had already lost `stripRegionPrefix`: inert
// today (zero region names in either corpus carry the numeric prefix) and one edit away from
// two spellings of one place.

/** ⚠ „23. София" IS A LIST ORDINAL, NOT PART OF THE NAME. The parliamentary corpus prints
 *  region names with an МИР number in some vintages; the English side of the same row never
 *  does, so leaving it in renders the ordinal on one language only. */
const stripRegionPrefix = (name?: string) =>
  (name ?? "").replace(/^\d+\.\s*/, "");

export interface LabelledSettlement {
  ekatte: string;
  settlement?: string;
  settlement_en?: string;
  region_name?: string;
  region_name_en?: string;
}

/** ⚠ THE ЕКАТТЕ IS THE LAST RESORT, NEVER A BLANK. An unnamed row in a list of flagged
 *  settlements reads as one more place to a reader counting them. */
export const settlementLabel = (
  s: LabelledSettlement,
  isBg: boolean,
): string => {
  const settlement = isBg ? s.settlement : (s.settlement_en ?? s.settlement);
  const region = isBg
    ? stripRegionPrefix(s.region_name)
    : (s.region_name_en ?? stripRegionPrefix(s.region_name));
  return [settlement, region].filter(Boolean).join(", ") || s.ekatte;
};
