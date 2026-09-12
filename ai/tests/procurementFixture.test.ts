import { describe, expect, it } from "vitest";
import fixture from "./fixtures/procurement-query.json";

// Independent arithmetic oracle. No production filter/scorer is imported here.
const base = fixture.contracts.filter(
  (r) =>
    r.tag === "contract" &&
    r.role !== "member" &&
    r.date >= "2026-01-01" &&
    r.date < "2027-01-01",
);
describe("procurement record population decision", () => {
  it("pins every expected field against independent arithmetic", () => {
    const actual = {
      records: base.length,
      currentEur: base.reduce((s, r) => s + (r.amount ?? 0), 0),
      signingEur: base.reduce((s, r) => s + (r.signingAmount ?? 0), 0),
      oneBid: base.filter((r) => r.bids === 1).length,
      positiveKnown: base.filter((r) => r.bids !== null && r.bids > 0).length,
      zero: base.filter((r) => r.bids === 0).length,
      missingBids: base.filter((r) => r.bids === null).length,
      missingAmount: base.filter((r) => r.amount === null).length,
    };
    expect(actual).toEqual({
      records: 6,
      currentEur: 1050,
      signingEur: 1030,
      oneBid: 3,
      positiveKnown: 4,
      zero: 1,
      missingBids: 1,
      missingAmount: 1,
    });
    expect(fixture.expected2026).toEqual(actual);
  });
  it("separates amendments and member participation from awards", () => {
    expect(base.map((r) => r.key)).toEqual([
      "a1",
      "a2",
      "a3",
      "a4",
      "a5",
      "a6",
    ]);
    expect(base.length).toBe(fixture.expected2026.records);
    expect(base.reduce((s, r) => s + (r.amount ?? 0), 0)).toBe(1050);
    expect(base.reduce((s, r) => s + (r.signingAmount ?? 0), 0)).toBe(1030);
    expect(base.filter((r) => r.amount === null)).toHaveLength(1);
  });
  it("keeps all, positive-known, zero and unknown bidder denominators distinct", () => {
    expect(base.filter((r) => r.bids === 1)).toHaveLength(3);
    expect(base.filter((r) => r.bids !== null && r.bids > 0)).toHaveLength(4);
    expect(base.filter((r) => r.bids === 0)).toHaveLength(1);
    expect(base.filter((r) => r.bids === null)).toHaveLength(1);
    expect(3 / 6).toBe(0.5);
    expect(3 / 4).toBe(0.75);
  });
  it("distinguishes buyer classification from purchased subject", () => {
    expect(base.filter((r) => r.buyer === "H").map((r) => r.key)).toEqual([
      "a1",
      "a2",
      "a5",
      "a6",
    ]);
    expect(
      base.filter((r) => r.cpv.startsWith("33")).map((r) => r.key),
    ).toEqual(["a1", "a2", "a6"]);
  });
  it("does not multiply acts or procedures when two complaints share them", () => {
    expect(fixture.appeals).toHaveLength(4);
    expect(
      new Set(fixture.appeals.map((r) => r.unp).filter(Boolean)).size,
    ).toBe(2);
    expect(fixture.decisions).toHaveLength(3);
    expect(fixture.appeals.filter((r) => !r.unp)).toHaveLength(1);
    expect(
      fixture.appeals.filter((r) => r.act === "d1").map((r) => r.id),
    ).toEqual(["c1", "c2"]);
    expect(
      fixture.decisions
        .filter((d) => !fixture.appeals.some((a) => a.act === d.id))
        .map((d) => d.id),
    ).toEqual(["d3"]);
    expect(
      fixture.appeals.every(
        (a) => !a.act || fixture.decisions.some((d) => d.id === a.act),
      ),
    ).toBe(true);
  });
  it("pins complaint versus act cohorts and independently recorded outcomes", () => {
    expect(
      fixture.appeals.filter((r) => r.date >= "2026-01-01").map((r) => r.id),
    ).toEqual(["c2", "c3", "c4"]);
    expect(
      fixture.decisions.filter((r) => r.date >= "2026-01-01").map((r) => r.id),
    ).toEqual(["d1", "d2", "d3"]);
    expect(
      fixture.appeals.map(
        (r) =>
          r.outcome ?? (r.status?.includes("отказано") ? "отказана" : null),
      ),
    ).toEqual(["уважена", "отхвърлена", "отказана", null]);
    expect(
      fixture.appeals.map(
        (r) => r.suspended ?? Boolean(r.status?.includes("спрян")),
      ),
    ).toEqual([false, false, false, true]);
    expect(fixture.appeals.filter((r) => r.requested).map((r) => r.id)).toEqual(
      ["c2", "c4"],
    );
  });
  it("freezes composite truth rather than equating unknown with false", () => {
    const or = base.map((r) =>
      r.weak === true || r.pep === true ? true : r.weak === null ? null : false,
    );
    const and = base.map((r) =>
      r.weak === false || r.pep === false
        ? false
        : r.weak === null
          ? null
          : true,
    );
    const not = base.map((r) => (r.weak === null ? null : !r.weak));
    expect(or).toEqual([true, false, false, true, null, true]);
    expect(and).toEqual([true, false, false, null, false, false]);
    expect(not).toEqual([false, true, true, null, null, false]);
  });
});
