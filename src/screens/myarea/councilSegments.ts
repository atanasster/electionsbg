// Council-composition palette + segment builder for MyAreaGovernmentCard's
// current-cycle headline bar. Kept as a standalone module so the palette /
// fallback rules can be reused if another council-bar view is added later.

import type { LocalCouncilParty } from "@/data/local/types";

export type CouncilSegment = {
  key: string;
  label: string;
  color: string;
  seats: number;
  party: LocalCouncilParty;
};

// Distinguishable shades for council parties that have no canonical color
// (independents and local coalitions). Cycled in sort order so adjacent
// unmapped parties never collapse into the same grey blob.
export const UNMAPPED_PALETTE = [
  "#94A3B8", // slate-400
  "#A78BFA", // violet-400
  "#FBBF24", // amber-400
  "#34D399", // emerald-400
  "#F472B6", // pink-400
  "#FB923C", // orange-400
  "#22D3EE", // cyan-400
  "#C084FC", // purple-400
];
export const INDEPENDENT_COLOR = "#6B7280"; // slate-500 — reserved for "Независим"

export const buildCouncilSegments = (
  council: LocalCouncilParty[] | undefined,
  displayNameForId: (id: string) => string | undefined,
  colorFor: (n: string) => string | undefined,
): CouncilSegment[] => {
  if (!council) return [];
  const parties = council
    .filter((p) => p.mandatesWon > 0)
    .sort((a, b) => b.mandatesWon - a.mandatesWon);
  let unmappedIdx = 0;
  return parties.map((p) => {
    const canonicalId = p.primaryCanonicalId;
    const label =
      (canonicalId ? displayNameForId(canonicalId) : null) ?? p.localPartyName;
    const canonicalColor = canonicalId ? colorFor(label) : undefined;
    let color: string;
    if (canonicalColor) {
      color = canonicalColor;
    } else if (p.isIndependent) {
      color = INDEPENDENT_COLOR;
    } else {
      color = UNMAPPED_PALETTE[unmappedIdx % UNMAPPED_PALETTE.length];
      unmappedIdx++;
    }
    return {
      key: `${p.localPartyNum}-${p.localPartyName}`,
      label,
      color,
      seats: p.mandatesWon,
      party: p,
    };
  });
};
