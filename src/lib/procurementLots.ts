// Fold the lots of ONE procurement (same УНП, same awarder) into one row for a
// "biggest contracts" list. МОН's distance-learning devices
// purchase of 2021-05-18 (УНП 00165-2021-0004) is four lot contracts
// (€32.2M + €17.0M + €12.8M + €6.1M); ranked row by row it fills half a top-8
// list with one decision and hides the €68M it actually was.
//
// Rows without a УНП (the pre-ЦАИС feeds) stay singletons: grouping on anything
// weaker (title, date) would merge unrelated procurements. The fold only sees the
// rows it is given, so a caller should fetch more rows than it renders — a lot
// outside the fetched window is simply not in its group's total, which
// UNDER-states, never over-states.

export interface LotRow {
  key: string;
  unp?: string | null;
  awarderEik?: string | null;
  amountEur: number | null;
}

export interface ProcurementGroup<T extends LotRow> {
  /** The largest lot — the row a list links to. */
  lead: T;
  /** Every lot, largest first; length 1 for an ordinary contract. */
  lots: T[];
  totalEur: number;
}

export const groupByProcurement = <T extends LotRow>(
  rows: readonly T[],
): ProcurementGroup<T>[] => {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const id = r.unp ? `${r.awarderEik ?? ""}|${r.unp}` : `key|${r.key}`;
    const g = groups.get(id);
    if (g) g.push(r);
    else groups.set(id, [r]);
  }
  return [...groups.values()]
    .map((lots) => {
      const sorted = [...lots].sort(
        (a, b) =>
          (b.amountEur ?? -Infinity) - (a.amountEur ?? -Infinity) ||
          a.key.localeCompare(b.key),
      );
      return {
        lead: sorted[0],
        lots: sorted,
        totalEur: sorted.reduce((s, r) => s + (r.amountEur ?? 0), 0),
      };
    })
    .sort(
      (a, b) => b.totalEur - a.totalEur || a.lead.key.localeCompare(b.lead.key),
    );
};
