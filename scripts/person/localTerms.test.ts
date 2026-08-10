import { describe, expect, it } from "vitest";
import {
  buildLocalTermIndex,
  isRegularLocalCycle,
  localCycleDate,
  localTermBounds,
} from "./localTerms";

const CORPUS = [
  { cycle: "2019_10_27_mi", seat: "mayor\tBLG11" },
  { cycle: "2023_10_29_mi", seat: "mayor\tBLG11" },
  // A partial that replaced ONE mayor mid-term.
  { cycle: "2021_06_27_chmi", seat: "mayor\tSML01" },
  { cycle: "2025_10_12_chmi_nov", seat: "village_mayor\tsettlement:53727" },
];

describe("localCycleDate", () => {
  it("reads the election date out of the cycle folder name", () => {
    expect(localCycleDate("2023_10_29_mi")).toBe("2023-10-29");
    expect(localCycleDate("2024_06_23_chmi")).toBe("2024-06-23");
    expect(localCycleDate("2025_10_12_chmi_nov")).toBe("2025-10-12");
  });

  it("returns null rather than minting an impossible date", () => {
    // These come from directory listings; an invalid ISO string would reach a `date` column.
    expect(localCycleDate("2023_13_29_mi")).toBeNull();
    expect(localCycleDate("2023_02_30_mi")).toBeNull();
    expect(localCycleDate("not_a_cycle")).toBeNull();
    expect(localCycleDate("")).toBeNull();
  });
});

describe("isRegularLocalCycle", () => {
  it("separates a general local election from a partial", () => {
    expect(isRegularLocalCycle("2023_10_29_mi")).toBe(true);
    expect(isRegularLocalCycle("2019_10_27_mi")).toBe(true);
  });

  // The trap: "2024_06_23_chmi" also ENDS in "mi". Classifying it as regular would retire
  // every mandate in the country on the day one village voted.
  it("does not mistake a partial for a general election", () => {
    expect(isRegularLocalCycle("2024_06_23_chmi")).toBe(false);
    expect(isRegularLocalCycle("2024_06_23_chmi_nov")).toBe(false);
  });
});

describe("localTermBounds", () => {
  const index = buildLocalTermIndex(CORPUS);

  it("starts a mandate at its own election", () => {
    expect(localTermBounds("2019_10_27_mi", "mayor\tBLG11", index).start).toBe(
      "2019-10-27",
    );
  });

  it("ends a mandate at the NEXT regular cycle", () => {
    expect(localTermBounds("2019_10_27_mi", "mayor\tBLG11", index).end).toBe(
      "2023-10-29",
    );
  });

  it("leaves the current mandate open", () => {
    expect(
      localTermBounds("2023_10_29_mi", "mayor\tBLG11", index).end,
    ).toBeNull();
  });

  it("ends early when a PARTIAL contested that seat first", () => {
    // SML01's mayor was replaced in 2021, four years before the next general election.
    expect(localTermBounds("2019_10_27_mi", "mayor\tSML01", index).end).toBe(
      "2021-06-27",
    );
  });

  it("does NOT let a partial elsewhere end an unrelated seat", () => {
    // The whole reason partials are indexed per seat: BLG11's mayor keeps their term
    // through SML01's 2021 by-election.
    expect(localTermBounds("2019_10_27_mi", "mayor\tBLG11", index).end).toBe(
      "2023-10-29",
    );
  });

  it("ends the winner of a partial at the next regular cycle", () => {
    const idx = buildLocalTermIndex([
      ...CORPUS,
      { cycle: "2021_06_27_chmi", seat: "mayor\tSML01" },
    ]);
    expect(localTermBounds("2021_06_27_chmi", "mayor\tSML01", idx).end).toBe(
      "2023-10-29",
    );
  });

  it("still ends an UNIDENTIFIABLE seat at the next regular cycle", () => {
    // район mayors, and кметства whose place degraded to the община. The seat key is only
    // needed to detect an EARLY end from a partial; a general election contests every local
    // office, so the regular-cycle bound holds for a seat we cannot name.
    const b = localTermBounds("2019_10_27_mi", null, index);
    expect(b.start).toBe("2019-10-27");
    expect(b.end).toBe("2023-10-29");
  });

  it("cannot see a by-election that ended an unidentifiable seat early", () => {
    // Stated so the limit is a known one: SML01's 2021 partial is invisible without a seat
    // key, so this term reads four years long. Over-stating a term is the failure we accept;
    // the alternative is dropping the end date for 46 район mayors entirely.
    expect(localTermBounds("2019_10_27_mi", null, index).end).toBe(
      "2023-10-29",
    );
  });

  it("yields nothing at all for an unparseable cycle", () => {
    expect(localTermBounds("garbage", "mayor\tBLG11", index)).toEqual({
      start: null,
      end: null,
    });
  });
});

describe("buildLocalTermIndex", () => {
  it("indexes partials per seat and regulars globally", () => {
    const idx = buildLocalTermIndex(CORPUS);
    expect(idx.regular).toEqual(["2019-10-27", "2023-10-29"]);
    expect(idx.partialsBySeat.get("mayor\tSML01")).toEqual(["2021-06-27"]);
  });

  it("keeps both lists sorted regardless of input order", () => {
    const idx = buildLocalTermIndex([
      { cycle: "2023_10_29_mi", seat: null },
      { cycle: "2007_10_28_mi", seat: null },
      { cycle: "2019_10_27_mi", seat: null },
      { cycle: "2025_02_16_chmi", seat: "mayor\tX" },
      { cycle: "2021_06_27_chmi", seat: "mayor\tX" },
    ]);
    expect(idx.regular).toEqual(["2007-10-28", "2019-10-27", "2023-10-29"]);
    expect(idx.partialsBySeat.get("mayor\tX")).toEqual([
      "2021-06-27",
      "2025-02-16",
    ]);
  });

  it("ignores a partial with no identifiable seat", () => {
    const idx = buildLocalTermIndex([{ cycle: "2021_06_27_chmi", seat: null }]);
    expect(idx.partialsBySeat.size).toBe(0);
  });
});
