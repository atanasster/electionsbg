// The same-day join, and the shape it deliberately does not use.
//
// ⚠ ONE PAIR EXISTS IN THE COMMITTED CORPUS AND THE RULE IS NOT WRITTEN FOR ONE. A hard-coded
// 2011 ↔ 2011 pair would be smaller and would go silently wrong the first time the calendar
// repeats — 2026's presidential decree is the live case.

import { describe, expect, it } from "vitest";
import { localSameDayAs, presidentialSameDayAs } from "./sameDayPresidential";
import { PRESIDENTIAL_CATALOGUE } from "@/data/presidentialCatalogue";
import allLocal from "@/data/json/local_elections.json";

describe("presidentialSameDayAs", () => {
  it("finds 2011's presidential cycle from its local one", () => {
    expect(presidentialSameDayAs("2011_10_23_mi")?.name).toBe("2011_10_23_pvr");
  });

  it("is empty for a local cycle with no presidential vote that day", () => {
    for (const c of ["2023_10_29_mi", "2019_10_27_mi", "2015_10_25_mi"])
      expect(presidentialSameDayAs(c), c).toBeUndefined();
  });

  it("refuses a slug the catalogue does not carry", () => {
    // ⚠ THE JOIN IS CATALOGUE-TO-CATALOGUE ON THE ROUND-1 DATE, never a shared slug prefix.
    // Matching `2001_11_11_mi` against `2001_11_11_pvr` on the prefix would mint a link to a
    // local cycle this build has never heard of — the „resolve through a shape" defect.
    expect(presidentialSameDayAs("2001_11_11_mi")).toBeUndefined();
    expect(presidentialSameDayAs("2016_11_06_mi")).toBeUndefined();
    expect(presidentialSameDayAs(undefined)).toBeUndefined();
    expect(presidentialSameDayAs("nonsense")).toBeUndefined();
  });
});

describe("localSameDayAs", () => {
  it("is the inverse on the one pair that exists", () => {
    expect(localSameDayAs("2011_10_23_pvr")?.name).toBe("2011_10_23_mi");
  });

  it("is empty for every presidential cycle but 2011", () => {
    // ⚠ IT ITERATES THE CATALOGUE rather than a typed count — „the four" was the comment's own
    // wording and it also asserted, wrongly, that the other four fall in years with no local
    // vote. 2016 has one: `2016_11_06_chmi`, two kmetstvo-mayor races on presidential polling
    // day, excluded because it is a PARTIAL (see the module header).
    for (const c of PRESIDENTIAL_CATALOGUE.map((e) => e.name).filter(
      (n) => n !== "2011_10_23_pvr",
    ))
      expect(localSameDayAs(c), c).toBeUndefined();
  });

  it("excludes a PARTIAL local cycle held on a presidential polling day", () => {
    // ⚠ THE DECISION, PINNED. 2016-11-06 carried both `2016_11_06_pvr` round 1 and
    // `2016_11_06_chmi`; the pill would have labelled two by-elections in two villages
    // „Местни избори 2016". The exclusion rests on `local_elections.json` holding regular cycles
    // only — a registry decision one import away from being undone — so it is asserted here
    // rather than left to the file.
    expect(localSameDayAs("2016_11_06_pvr")).toBeUndefined();
    expect(presidentialSameDayAs("2016_11_06_chmi")).toBeUndefined();
    // …and the premise: no partial is in the registry this reads.
    expect(
      (allLocal as { kind: string }[]).filter((c) => c.kind !== "regular"),
    ).toEqual([]);
  });

  it("round-trips every pair it finds", () => {
    // ⚠ SYMMETRY IS NOT FREE — the two functions read the two registries in opposite
    // directions, so a date normalised on one side and not the other would give a link that
    // exists going one way and not back.
    for (const e of PRESIDENTIAL_CATALOGUE) {
      const local = localSameDayAs(e.name);
      if (!local) continue;
      expect(presidentialSameDayAs(local.name)?.name).toBe(e.name);
    }
  });

  it("matches exactly one cycle per date on BOTH sides, so no pair is arbitrary", () => {
    // Two cycles sharing a round-1 date would make `find` pick by array order — a link that is
    // stable only because the file happens to be sorted. ⚠ The presidential side needs the same
    // check: `localSameDayAs` does its `find` there, and a one-sided gate leaves that half
    // resting on the same accident it forbids in the other.
    const local = (allLocal as { round1Date: string }[]).map(
      (c) => c.round1Date,
    );
    expect(new Set(local).size).toBe(local.length);
    const pres = PRESIDENTIAL_CATALOGUE.map((e) => e.round1Date);
    expect(new Set(pres).size).toBe(pres.length);
  });
});
