import { describe, expect, it } from "vitest";
import type { MatrixCell } from "./data";
import { cellView } from "./personMatrix";

const RULES = { cell_min_n: 5, hatch_below_n: 10, coverage_floor: 0.8 };
const counts = {
  strongly_unfavorable: 0,
  unfavorable: 0,
  neutral: 5,
  favorable: 0,
  strongly_favorable: 0,
};
const cell = (patch: Partial<MatrixCell> = {}): MatrixCell => ({
  n: 12,
  counts,
  mean: -0.8,
  mean_bucket: "unfavorable",
  dev: -0.6,
  dev_sign: -1,
  ...patch,
});

describe("cellView", () => {
  it("under five units there is no colour at all", () => {
    expect(cellView(cell({ n: 4 }), "position", RULES).state).toBe("blank");
    expect(cellView(undefined, "position", RULES).state).toBe("blank");
    // A cell with no mean is blank whatever its n says.
    expect(cellView(cell({ mean: undefined }), "position", RULES).state).toBe(
      "blank",
    );
  });

  it("five to nine units are faded", () => {
    expect(cellView(cell({ n: 7 }), "position", RULES).state).toBe("hatched");
    expect(cellView(cell(), "position", RULES).state).toBe("filled");
  });

  it("position mode colours by the mean's bucket", () => {
    expect(cellView(cell(), "position", RULES).fill).toContain("bg-negative");
  });

  it("deviation mode colours only a gap whose interval excludes zero", () => {
    expect(cellView(cell(), "deviation", RULES).deviation).toBe(-1);
    // Mutation check: the same gap with an interval straddling zero is grey.
    const grey = cellView(cell({ dev_sign: 0 }), "deviation", RULES);
    expect(grey.deviation).toBe(0);
    expect(grey.fill).toContain("muted");
    expect(
      cellView(cell({ dev_sign: undefined }), "deviation", RULES).fill,
    ).toContain("muted");
  });
});
