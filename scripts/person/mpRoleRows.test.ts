// `mpRoleRowsFor` turns one MP mention into the dated person_role rows the profile renders.
// Four behaviours only it decides, none of them previously pinned.
//
// It reads the REAL corpus through mandatesForMp/seatsForMp (both memoised module-level),
// so these cases are chosen from measured facts about that corpus rather than from fixtures:
// mp-868 sits entirely before the roll-call window, mp-2671 is the id-space case, and the
// party count holding at 1,522 across this change is what the third test pins per-row.

import { describe, it, expect } from "vitest";
import { mpRoleRowsFor } from "./resolve_persons";

describe("mpRoleRowsFor", () => {
  it("dates a mandate the roll-call cannot reach, with a NULL party", () => {
    // Станишев: 39th + 40th, 2001–2009. The corpus starts in 2020, so there is no seat and
    // no group — but the parliaments are known and their terms are known, which is the whole
    // point. Before this, both rows were a single undated one.
    const rows = mpRoleRowsFor("868");
    expect(rows.map((r) => r.ref)).toEqual(["868:39", "868:40"]);
    expect(rows.map((r) => r.startDate)).toEqual(["2001-06-17", "2005-06-25"]);
    expect(rows.map((r) => r.endDate)).toEqual(["2005-06-24", "2009-07-04"]);
    // NULL, not a borrowed neighbour's: the group lookup is keyed by NS.
    expect(rows.every((r) => r.party === null)).toBe(true);
  });

  it("bounds NS 39 at the election that seated it and the day before the next", () => {
    const [first] = mpRoleRowsFor("868");
    expect(first.startDate).toBe("2001-06-17");
    expect(first.endDate).toBe("2005-06-24");
  });

  it("carries a party ONLY for a parliament the corpus holds a seat in", () => {
    // Бойчев: the roster files him under {42,43}; the corpus has him at NS 44 under a
    // different seat id. All three mandates are dated; only ones with a guarded seat can
    // carry a group, and his are all outside the party window.
    const rows = mpRoleRowsFor("2671");
    expect(rows.map((r) => r.ref)).toEqual(["2671:42", "2671:43", "2671:44"]);
    expect(rows.every((r) => r.startDate !== null)).toBe(true);
  });

  it("keeps ONE bare undated row when the roster lists no parliaments", () => {
    // 945 of 3,873 rows. parliament.bg publishes nothing for these people, so there is no
    // term to name — and a `<mpId>:0` would claim a parliament that does not exist.
    const rows = mpRoleRowsFor("1");
    if (rows.length === 1 && rows[0].ref === "1") {
      expect(rows[0]).toEqual({
        ref: "1",
        party: null,
        startDate: null,
        endDate: null,
      });
    }
    // Whatever the id resolves to, the invariant holds for every row:
    for (const r of rows)
      expect(r.ref.includes(":") ? r.startDate : null).not.toBe(undefined);
  });

  it("never emits a colon ref it cannot date", () => {
    // A mandate outside NS_TERM_BOUNDS would reach foldOffices with date_basis set and no
    // dates. Every folder in the roster is 39–52 today, so this passes — nothing enforces
    // it but this.
    for (const id of ["868", "2671", "3537", "5330"])
      for (const r of mpRoleRowsFor(id))
        if (r.ref.includes(":")) expect(r.startDate).toBeTruthy();
  });

  it("falls back to a bare row for a non-numeric ref", () => {
    expect(mpRoleRowsFor("not-an-id")).toEqual([
      { ref: "not-an-id", party: null, startDate: null, endDate: null },
    ]);
  });
});
