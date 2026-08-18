// €/kg is the right way to compare a 400g jar with a 700g one, and the wrong
// way to compare either with a 10kg sack.
//
// Measured on the 2026-08 corpus, the /prices "най-много храна за парите" board
// listed 5kg olives (0.84), 10kg onions (0.84), 8kg olive pâté (0.89), 10kg
// olives (0.89), 5kg olives (0.91) and 10kg potatoes (0.91) — and the first
// thing a household would buy, 1kg flour at 0.92, sat seventh. Bulk is cheaper
// per kilo by definition, so the board was ranking pack size.

import { describe, it, expect } from "vitest";
import { householdPacks, HOUSEHOLD_PACK_MAX_G } from "./usePrices";

const item = (title: string, netQty: number, eurPerUnit: number) => ({
  slug: title,
  title,
  netQty,
  eurPerUnit,
});

/** The real head of that board, in order. */
const REAL = [
  item("Маслини Ефес 5кг", 5000, 0.84),
  item("10КГ КРОМИД ЛУК 80+", 10000, 0.84),
  item("КА ПАСТЕТ ОТ МАСЛИНИ 4Х2КГ", 8000, 0.89),
  item("КА МАСЛИНИ КАЛАМАТА 2Х5КГ", 10000, 0.89),
  item("МАСЛИНИ КАЛАМАТА 5КГ", 5000, 0.91),
  item("10КГ МИТИ КАРТОФИ", 10000, 0.91),
  item("Бяло брашно Кръстев 1кг", 1000, 0.92),
];

describe("householdPacks", () => {
  it("removes the catering tier that owned the board", () => {
    const { rows, bulkOnly } = householdPacks(REAL);
    expect(rows.map((r) => r.title)).toEqual(["Бяло брашно Кръстев 1кг"]);
    expect(bulkOnly).toBe(false);
  });

  it("changes the answer — the top item was never a household one", () => {
    const cheapestRaw = [...REAL].sort(
      (a, b) => a.eurPerUnit - b.eurPerUnit,
    )[0];
    const cheapestReal = householdPacks(REAL).rows.sort(
      (a, b) => a.eurPerUnit - b.eurPerUnit,
    )[0];
    expect(cheapestRaw.netQty).toBe(5000);
    expect(cheapestReal.netQty).toBe(1000);
  });

  it("keeps the largest ORDINARY grocery pack", () => {
    // The ceiling has to admit a 2L oil and a 3kg washing powder, or it starts
    // hiding real answers instead of bulk ones.
    const { rows } = householdPacks([
      item("2L oil", 2000, 3),
      item("3kg powder", 3000, 4),
      item("5kg sack", 5000, 1),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["2L oil", "3kg powder"]);
  });

  it("is inclusive at the ceiling, exclusive above it", () => {
    expect(householdPacks([item("at", HOUSEHOLD_PACK_MAX_G, 1)]).bulkOnly).toBe(
      false,
    );
    expect(
      householdPacks([item("over", HOUSEHOLD_PACK_MAX_G + 1, 1)]).bulkOnly,
    ).toBe(true);
  });

  it("falls back rather than emptying a bulk-only category", () => {
    // A category genuinely sold only in catering sizes is a real answer, not a
    // reason to render nothing — and the caller is told, so it can say so.
    const bulk = REAL.filter((r) => r.netQty > HOUSEHOLD_PACK_MAX_G);
    const { rows, bulkOnly } = householdPacks(bulk);
    expect(rows).toHaveLength(bulk.length);
    expect(bulkOnly).toBe(true);
  });

  it("drops items with no parsed size rather than treating 0 as tiny", () => {
    // netQty 0 means "unparsed", and 0 <= ceiling would rank it as the smallest
    // pack of all.
    const { rows } = householdPacks([
      item("unknown", 0, 0.1),
      item("1kg", 1000, 2),
    ]);
    expect(rows.map((r) => r.title)).toEqual(["1kg"]);
  });

  it("makes no bulk-only claim about an empty list", () => {
    // bulkOnly is a sentence the caller renders ("sold only in catering
    // sizes"); nothing was suppressed here, so it must not be asserted.
    expect(householdPacks([])).toEqual({ rows: [], bulkOnly: false });
  });

  it("does not hand back the caller's array to be sorted in place", () => {
    const input = [item("5kg", 5000, 1), item("10kg", 10000, 2)];
    const { rows } = householdPacks(input);
    rows.sort((a, b) => b.eurPerUnit - a.eurPerUnit);
    expect(input.map((r) => r.title)).toEqual(["5kg", "10kg"]);
  });
});
