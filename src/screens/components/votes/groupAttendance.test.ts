import { describe, it, expect } from "vitest";
import { aggregateAttendanceByGroup } from "./groupAttendance";

describe("aggregateAttendanceByGroup", () => {
  it("weights by items rather than averaging member percentages", () => {
    // One member present for the whole term at 50%, one sworn in late at 100%.
    // The unweighted mean is 75%; weighted is 550/1040 ≈ 52.9%. The group did
    // not attend three quarters of its slots, and the figure must not say so.
    const [g] = aggregateAttendanceByGroup([
      { party: "ГЕРБ-СДС", presentCount: 500, totalItems: 1000 },
      { party: "ГЕРБ-СДС", presentCount: 40, totalItems: 40 },
    ]);
    expect(g.presentPct).toBeCloseTo(540 / 1040, 6);
    expect(g.presentPct).toBeLessThan(0.75);
    expect(g.members).toBe(2);
    expect(g.totalItems).toBe(1040);
    expect(g.presentCount).toBe(540);
  });

  it("sorts by attendance descending", () => {
    const rows = aggregateAttendanceByGroup([
      { party: "A", presentCount: 40, totalItems: 100 },
      { party: "B", presentCount: 90, totalItems: 100 },
      { party: "C", presentCount: 70, totalItems: 100 },
    ]);
    expect(rows.map((r) => r.party)).toEqual(["B", "C", "A"]);
  });

  it("drops groups with no items rather than rendering them at zero", () => {
    const rows = aggregateAttendanceByGroup([
      { party: "A", presentCount: 0, totalItems: 0 },
      { party: "B", presentCount: 1, totalItems: 2 },
    ]);
    expect(rows.map((r) => r.party)).toEqual(["B"]);
  });

  it("ignores rows with a blank party label", () => {
    const rows = aggregateAttendanceByGroup([
      { party: "", presentCount: 5, totalItems: 10 },
      { party: "  ", presentCount: 5, totalItems: 10 },
      { party: "A", presentCount: 5, totalItems: 10 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].party).toBe("A");
  });

  it("returns an empty list for no input", () => {
    expect(aggregateAttendanceByGroup([])).toEqual([]);
  });
});
