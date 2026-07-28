import { describe, it, expect } from "vitest";
import {
  primaryRegion,
  pickPrimaryMir,
  type RegionRow,
} from "./candidateRegions";

const r = (oblast: string, totalVotes?: number): RegionRow => ({
  oblast,
  totalVotes,
});

describe("primaryRegion", () => {
  it("picks the МИР with the most preference votes", () => {
    // The whole point: `oblasts[0]` is arbitrary, and on the 15.9% of candidacies that
    // span more than one МИР it named the seated one just 47% of the time.
    expect(primaryRegion([r("S23", 67), r("S25", 402)])).toBe("S25");
  });

  it("is deterministic on a tie", () => {
    // Ties break on the code so two runs of the resolver cannot disagree.
    expect(primaryRegion([r("VAR", 10), r("BGS", 10)])).toBe("BGS");
    expect(primaryRegion([r("BGS", 10), r("VAR", 10)])).toBe("BGS");
  });

  it("treats a missing vote count as zero rather than skipping the row", () => {
    expect(primaryRegion([r("VAR"), r("BGS", 1)])).toBe("BGS");
    expect(primaryRegion([r("VAR")])).toBe("VAR");
  });

  it("ignores rows with no oblast", () => {
    expect(primaryRegion([{ totalVotes: 999 }, r("PVN", 1)])).toBe("PVN");
  });

  it("returns null for no usable rows", () => {
    // 24% of candidacies have no recorded preferences anywhere. That is an absence, and
    // it must stay one rather than becoming a guessed constituency.
    expect(primaryRegion([])).toBeNull();
    expect(primaryRegion([{ totalVotes: 5 }])).toBeNull();
  });

  it("keeps the two Plovdiv constituencies distinct", () => {
    expect(primaryRegion([r("PDV", 5), r("PDV-00", 9)])).toBe("PDV-00");
  });
});

describe("pickPrimaryMir", () => {
  const REG = [r("PVN", 277), r("S25", 380)];

  it("prefers the seated МИР over the best-polling one", () => {
    // Rule 1 beats Rule 2: an MP seated from Плевен shows Плевен even though they drew
    // more preferences in София 25.
    expect(pickPrimaryMir(REG, "PVN", "S25")).toBe("PVN");
  });

  it("ignores a seat this candidacy did not contest", () => {
    // The regression: parliament.bg holds ONE seat per person with no cycle attached, so
    // a 39th-NS seat was being stamped onto 2022–2026 candidacies. A seat that is not
    // among the candidacy's own regions must not win.
    expect(pickPrimaryMir(REG, "BGS", null)).toBe("S25");
  });

  it("never invents a place from a seat alone", () => {
    // A candidacy with no region rows at all (24% of them) stays unplaced, even when the
    // person was seated at some point in their career.
    expect(pickPrimaryMir([], "BGS", null)).toBeNull();
  });

  it("falls back to the ballot oblast when there are no vote rows", () => {
    expect(pickPrimaryMir([], null, "VAR")).toBe("VAR");
  });

  it("prefers real vote rows over the ballot fallback", () => {
    expect(pickPrimaryMir(REG, null, "VAR")).toBe("S25");
  });
});
