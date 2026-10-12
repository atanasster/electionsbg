// D3 (docs/plans/water-hub-v1.md): which operators active in the window the map
// cannot place. Pure, so the three rules are testable:
//   · nothing until the map has ANSWERED — before that every operator would
//     read as unplaceable;
//   · only operators with a contract in the window (a zero row is not missing
//     from the map, it is absent from the window);
//   · placed = returned by the map route, which drops unresolved seats.

export const unpinnedOperators = <
  T extends {
    eik: string;
    name: string;
    totalEur: number;
    contractCount: number;
  },
>(
  operators: readonly T[],
  placedEiks: readonly string[],
  mapReady: boolean,
): { eik: string; name: string; totalEur: number }[] => {
  if (!mapReady || !placedEiks.length) return [];
  const placed = new Set(placedEiks);
  return operators
    .filter((o) => o.contractCount > 0 && !placed.has(o.eik))
    .map((o) => ({ eik: o.eik, name: o.name, totalEur: o.totalEur }));
};
