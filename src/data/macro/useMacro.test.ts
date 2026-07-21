import { describe, expect, it } from "vitest";
import {
  labelForFractionalX,
  pointToFractionalX,
  type MacroPoint,
} from "./useMacro";

describe("pointToFractionalX", () => {
  it("places annual points at mid-year", () => {
    expect(pointToFractionalX({ year: 2024, value: 1 })).toBeCloseTo(2024.5, 6);
  });

  it("places quarterly points at mid-quarter", () => {
    const q = (quarter: 1 | 2 | 3 | 4) =>
      pointToFractionalX({ year: 2024, quarter, value: 1 });
    expect(q(1)).toBeCloseTo(2024.125, 6);
    expect(q(2)).toBeCloseTo(2024.375, 6);
    expect(q(3)).toBeCloseTo(2024.625, 6);
    expect(q(4)).toBeCloseTo(2024.875, 6);
  });

  it("places monthly points at mid-month", () => {
    const m = (month: number) =>
      pointToFractionalX({ year: 2024, month, value: 1 });
    expect(m(1)).toBeCloseTo(2024 + 1 / 24, 6); // mid-January
    expect(m(12)).toBeCloseTo(2024 + 11 / 12 + 1 / 24, 6); // mid-December
  });

  it("prefers month over quarter when both are set (month wins)", () => {
    const p: MacroPoint = { year: 2024, month: 1, quarter: 1, value: 1 };
    expect(pointToFractionalX(p)).toBeCloseTo(2024 + 1 / 24, 6);
  });
});

describe("labelForFractionalX", () => {
  it("labels mid-year as the bare year", () => {
    expect(labelForFractionalX(2024.5)).toBe("2024");
  });

  it("labels quarter centers as quarters — NOT months (no regression on quarterly charts)", () => {
    // .125/.375/.625/.875 coincide with Feb/May/Aug/Nov month centers; quarter
    // must win so every existing quarterly chart keeps reading "Q1".."Q4".
    expect(labelForFractionalX(2024.125)).toBe("2024 Q1");
    expect(labelForFractionalX(2024.375)).toBe("2024 Q2");
    expect(labelForFractionalX(2024.625)).toBe("2024 Q3");
    expect(labelForFractionalX(2024.875)).toBe("2024 Q4");
  });

  it("labels off-quarter month centers as months", () => {
    expect(
      labelForFractionalX(
        pointToFractionalX({ year: 2024, month: 1, value: 0 }),
      ),
    ).toBe("2024 Jan");
    expect(
      labelForFractionalX(
        pointToFractionalX({ year: 2024, month: 3, value: 0 }),
      ),
    ).toBe("2024 Mar");
    expect(
      labelForFractionalX(
        pointToFractionalX({ year: 2024, month: 12, value: 0 }),
      ),
    ).toBe("2024 Dec");
  });

  it("round-trips every off-quarter month to its own label", () => {
    for (const month of [1, 3, 4, 6, 7, 9, 10, 12]) {
      const x = pointToFractionalX({ year: 2020, month, value: 0 });
      expect(labelForFractionalX(x)).toMatch(/^2020 [A-Z][a-z]{2}$/);
    }
  });

  it("labels coincident months (Feb/May/Aug/Nov) as their quarter — documented tradeoff", () => {
    // These four month centers land exactly on the quarter centers; the
    // quarter-first rule intentionally wins so quarterly charts never regress.
    // The known cost is that these months read as "Qn" on the monthly panel.
    const cases: [number, string][] = [
      [2, "2024 Q1"],
      [5, "2024 Q2"],
      [8, "2024 Q3"],
      [11, "2024 Q4"],
    ];
    for (const [month, label] of cases) {
      const x = pointToFractionalX({ year: 2024, month, value: 0 });
      expect(labelForFractionalX(x)).toBe(label);
    }
  });
});
