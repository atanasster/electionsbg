// "Най-евтини вериги" was not a ranking.
//
// chains.json scores each chain on the subset it happens to price and sorts by
// the RAW SUM, so a chain missing items floats to the top. Measured on the
// 2026-08 corpus the hub's four "cheapest" priced 8, 7, 10 and 8 of 12, and on
// the full basket the true order is completely different (ЖИЗЕЛ 14.47, Лидл
// 14.50, BulMag 15.25 — none of which appeared). The builder's own note says
// "Compare like-with-like".

import { describe, it, expect } from "vitest";
import { comparableChains, type ChainRow } from "./usePrices";

const row = (chain: string, basket: number, nPriced: number): ChainRow => ({
  eik: chain,
  chain,
  basket,
  nPriced,
});

/** The real top of the 2026-08 leaderboard, plus the cheapest full baskets. */
const REAL: ChainRow[] = [
  row("ДИМЕКС ООД", 10.99, 8),
  row("Вилтон", 12.38, 7),
  row("ТАРИТА", 12.45, 10),
  row("Супермаркети Славекс", 12.69, 8),
  row("ЖИЗЕЛ", 14.47, 12),
  row("Лидл България", 14.5, 12),
  row("BulMag", 15.25, 12),
];

describe("comparableChains", () => {
  it("drops every chain that does not price the whole basket", () => {
    const { rows, excluded } = comparableChains(REAL, 12);
    expect(rows.map((c) => c.chain)).toEqual([
      "ЖИЗЕЛ",
      "Лидл България",
      "BulMag",
    ]);
    expect(excluded).toBe(4);
  });

  it("changes the answer — this is not a cosmetic filter", () => {
    // The whole point: the chain the page called cheapest is not in the result,
    // and the one that IS cheapest was not on the page.
    const before = [...REAL].sort((a, b) => a.basket - b.basket)[0];
    const after = comparableChains(REAL, 12).rows[0];
    expect(before.chain).toBe("ДИМЕКС ООД");
    expect(after.chain).toBe("ЖИЗЕЛ");
    // …and per item, ДИМЕКС was never the cheapest either.
    expect(before.basket / before.nPriced).toBeGreaterThan(
      REAL.find((c) => c.chain === "ТАРИТА")!.basket / 10,
    );
  });

  it("MUTATION CHECK: preserves payload order, including a non-ascending one", () => {
    // An ascending fixture cannot fail against an implementation that sorts.
    // Ordering is the payload's job (buildChains already sorts); re-sorting
    // here would silently diverge from every other surface reading it.
    const unsorted = [row("B", 20, 12), row("A", 10, 12), row("C", 15, 12)];
    expect(comparableChains(unsorted, 12).rows.map((c) => c.chain)).toEqual([
      "B",
      "A",
      "C",
    ]);
  });

  it("MUTATION CHECK: >= not ===, on a fixture that cannot hit the fallback", () => {
    // The plan literally specifies `nPriced === commonBasketSize`, and a
    // single-row `>=` fixture triggers the fallback and masks the difference.
    // coreBasketSize is per-município, so a chain CAN price more than the
    // nominal size, and dropping it would be the defect inverted.
    const mixed = [
      row("over", 9, 13),
      row("exact", 11, 12),
      row("under", 8, 9),
    ];
    const { rows, excluded, fellBack } = comparableChains(mixed, 12);
    expect(rows.map((c) => c.chain)).toEqual(["over", "exact"]);
    expect(excluded).toBe(1);
    expect(fellBack).toBe(false);
  });

  it("prefers the PUBLISHED flag over re-deriving it", () => {
    // build_index owns the rule (SQL and the AI tool read the same field), so a
    // row that says it is not comparable is not comparable, whatever nPriced
    // says — and vice versa.
    const flagged = [
      { ...row("says-no", 10, 12), comparable: false },
      { ...row("says-yes", 11, 3), comparable: true },
    ];
    expect(comparableChains(flagged, 12).rows.map((c) => c.chain)).toEqual([
      "says-yes",
    ]);
  });

  it("falls back to the unfiltered list rather than emptying the tile", () => {
    // A corpus where nobody prices the full basket must still render — the
    // per-row coverage is shown beside each figure either way.
    const partial = REAL.filter((c) => c.nPriced < 12);
    const { rows, excluded, fellBack } = comparableChains(partial, 12);
    expect(rows).toHaveLength(partial.length);
    expect(excluded).toBe(0); // nothing was excluded, so nothing is claimed
    // …and the caller is TOLD, so it can drop the word "cheapest". Measured:
    // 32 of 130 município payloads are in this state, so a silent fallback
    // would re-publish the defect on a quarter of the places.
    expect(fellBack).toBe(true);
  });

  it("is a no-op without a basket size or a published flag", () => {
    expect(comparableChains(REAL, undefined).rows).toHaveLength(REAL.length);
    expect(comparableChains(REAL, 0).rows).toHaveLength(REAL.length);
  });

  it("handles an absent list without claiming a fallback", () => {
    const r = comparableChains(undefined, 12);
    expect(r.rows).toEqual([]);
    expect(r.fellBack).toBe(false); // nothing to fall back FROM
  });
});
