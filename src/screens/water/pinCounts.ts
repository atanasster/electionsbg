// F3 (water-hub-v1 T9): the map route counts €0 consortium MEMBER rows while the
// /water/operators table beneath it does not. Each pin takes its counts from the
// SAME ex-member rollup as the table, so a pin and its row cannot disagree. €
// is unchanged either way (member rows carry €0); the map keeps its geometry.
// A pin with no rollup row keeps its own figures.

interface Counts {
  eik: string;
  contractCount: number;
  bidKnownN: number;
  singleBidN: number;
  singleBidShare: number | null;
}

export const withRollupCounts = <P extends Counts>(
  pins: readonly P[],
  rollup: readonly Counts[],
): P[] => {
  const byEik = new Map(rollup.map((o) => [o.eik, o]));
  return pins.map((m) => {
    const o = byEik.get(m.eik);
    return o
      ? {
          ...m,
          contractCount: o.contractCount,
          bidKnownN: o.bidKnownN,
          singleBidN: o.singleBidN,
          singleBidShare: o.singleBidShare,
        }
      : m;
  });
};
