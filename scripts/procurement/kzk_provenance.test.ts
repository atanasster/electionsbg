// The provenance rule is what stands between a matcher fix and the destruction of
// ~2,098 irreplaceable hand-made outcomes. It lives in its own pure module for
// exactly this reason — inline in the rejoin's main() it could only be exercised
// against a live database.

import { describe, it, expect } from "vitest";
import { partitionByProvenance, type ProvenanceRow } from "./kzk_provenance";
import type { DecisionMatch } from "./kzk_match";

const match = (
  complaintNo: string,
  outcome: DecisionMatch["outcome"] = "уважена",
): DecisionMatch => ({
  complaintNo,
  actNo: "АКТ-5-15.06.2026",
  decisionDate: "2026-06-15",
  outcome,
});

const row = (p: Partial<ProvenanceRow> = {}): ProvenanceRow => ({
  outcome: null,
  decisionDate: null,
  decisionActNo: null,
  ...p,
});

describe("partitionByProvenance", () => {
  it("re-derives a machine-owned row", () => {
    const r = partitionByProvenance(
      [match("ВХР-1", "отхвърлена")],
      new Map([
        [
          "ВХР-1",
          row({ outcome: "уважена", decisionActNo: "АКТ-1-01.01.2026" }),
        ],
      ]),
    );
    expect(r.writable).toHaveLength(1);
    expect(r.refreshDerived).toBe(1);
    expect(r.protectedHand).toBe(0);
    // A machine row may be CORRECTED — that is the whole point of migration 131.
    expect(r.conflicts).toHaveLength(0);
  });

  it("fills a row with no outcome and no decision date", () => {
    const r = partitionByProvenance(
      [match("ВХР-1")],
      new Map([["ВХР-1", row()]]),
    );
    expect(r.writable).toHaveLength(1);
    expect(r.fillNew).toBe(1);
  });

  it("protects a hand-seeded row and records the disagreement in full", () => {
    const r = partitionByProvenance(
      [match("ВХР-1", "уважена")],
      new Map([
        ["ВХР-1", row({ outcome: "отхвърлена", decisionDate: "2026-01-01" })],
      ]),
    );
    expect(r.writable).toHaveLength(0);
    expect(r.protectedHand).toBe(1);
    expect(r.conflicts).toEqual([
      {
        complaintNo: "ВХР-1",
        actNo: "АКТ-5-15.06.2026",
        hand: "отхвърлена",
        derived: "уважена",
      },
    ]);
  });

  it("protects a hand-seeded row that AGREES, without flagging a conflict", () => {
    const r = partitionByProvenance(
      [match("ВХР-1", "уважена")],
      new Map([["ВХР-1", row({ outcome: "уважена" })]]),
    );
    expect(r.writable).toHaveLength(0);
    expect(r.protectedHand).toBe(1);
    expect(r.conflicts).toHaveLength(0);
  });

  it("does NOT fill a row that has a decision_date but no outcome", () => {
    // The generous boundary: something recorded that date and this function
    // cannot tell what, so the row counts as hand-touched.
    const r = partitionByProvenance(
      [match("ВХР-1")],
      new Map([["ВХР-1", row({ decisionDate: "2026-01-01" })]]),
    );
    expect(r.writable).toHaveLength(0);
    expect(r.protectedHand).toBe(1);
  });

  it("ignores a match for a complaint that is not in the table", () => {
    const r = partitionByProvenance([match("ВХР-МИСЛИВ")], new Map());
    expect(r.writable).toHaveLength(0);
    expect(r.fillNew + r.refreshDerived + r.protectedHand).toBe(0);
  });

  it("is total on empty input", () => {
    const r = partitionByProvenance([], new Map());
    expect(r).toEqual({
      writable: [],
      fillNew: 0,
      refreshDerived: 0,
      protectedHand: 0,
      conflicts: [],
    });
  });
});
