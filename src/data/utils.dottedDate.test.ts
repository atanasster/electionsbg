// `dottedDate` is the ONE definition of the dotted Bulgarian date form rendered by the
// person dashboard, the shared electoral body, the cycle-selector pills and every
// local-elections tile (through `friendlyCycleDate`, which delegates to it).
//
// It gets its own file because the anchoring was previously pinned only TRANSITIVELY, from a
// `describe("localCycleKind")` block about by-election classification — so a future reader
// reinstating the `$` the two person-page copies used to carry would not have looked there.
// Prefix anchoring is the load-bearing property: the local tree's cycle slugs carry a
// `_mi` / `_chmi` suffix that an end anchor rejects, which would render them raw.

import { describe, it, expect } from "vitest";
import { dottedDate } from "./utils";
import { friendlyCycleDate } from "./local/cycleDate";

describe("dottedDate", () => {
  it("formats a parliamentary election folder name", () => {
    expect(dottedDate("2024_10_27")).toBe("27.10.2024");
    expect(dottedDate("2026_04_19")).toBe("19.04.2026");
  });

  it("formats a local cycle slug, suffix and all", () => {
    // This is the case an END anchor rejects, and the reason the shared rule is prefixed.
    expect(dottedDate("2023_10_29_mi")).toBe("29.10.2023");
    expect(dottedDate("2024_06_23_chmi")).toBe("23.06.2024");
    expect(dottedDate("2024_10_20_chmi_nov")).toBe("20.10.2024");
  });

  it("DISCARDS whatever follows the date, deliberately", () => {
    // A display helper: showing "14.11.2021" for a key with junk appended is better than
    // showing the raw key, and the prefix rule is what makes the local slugs work at all.
    // The end-anchored copies passed such a key through visibly; this is the trade.
    expect(dottedDate("2021_11_14_garbage")).toBe("14.11.2021");
  });

  it("passes anything that is not date-shaped through untouched", () => {
    expect(dottedDate("")).toBe("");
    expect(dottedDate("not-a-date")).toBe("not-a-date");
    // An ISO date is a different separator and belongs to `friendlyIsoDate`.
    expect(dottedDate("2026-06-14")).toBe("2026-06-14");
    // Too few digits in a segment is not a date this repo emits.
    expect(dottedDate("2021_1_14")).toBe("2021_1_14");
  });

  it("is what friendlyCycleDate resolves to", () => {
    // The local tiles keep their own name for readability; there must be no second rule
    // behind it.
    for (const cycle of ["2023_10_29_mi", "2024_10_27", "nonsense", ""]) {
      expect(friendlyCycleDate(cycle)).toBe(dottedDate(cycle));
    }
  });
});
