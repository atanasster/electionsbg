// The cycle-kind classifier, which is the only place the SPA can learn that a
// vote was a by-election.
//
// `src/data/json/local_elections.json` carries a `kind` field but lists the
// REGULAR cycles only, so a lookup there returns undefined for every partial —
// which reads identically to "not found" and is why the label defaulted to
// „редовен". The folder-name suffix is the whole signal.

import { describe, expect, it } from "vitest";
import {
  friendlyCycleDate,
  friendlyIsoDate,
  localCycleKind,
} from "./cycleDate";

describe("localCycleKind", () => {
  it("reads a regular cycle off the _mi suffix", () => {
    expect(localCycleKind("2023_10_29_mi")).toBe("regular");
    expect(localCycleKind("2019_10_27_mi")).toBe("regular");
    expect(localCycleKind("2007_10_28_mi")).toBe("regular");
  });

  it("classifies both partial folder shapes", () => {
    expect(localCycleKind("2024_10_20_chmi")).toBe("partial");
    expect(localCycleKind("2024_06_23_chmi")).toBe("partial");
    expect(localCycleKind("2025_10_12_chmi_nov")).toBe("partial");
    expect(localCycleKind("2026_02_22_chmi")).toBe("partial");
  });

  // The trap this function exists for: a `_chmi` slug ALSO ends in "mi", so a
  // bare `endsWith("mi")` reached first calls a by-election a general one.
  // (`_chmi_nov` escapes it by accident, which is why the trap is easy to miss —
  // half the partials look fine under the broken test.)
  it("does not let a chmi slug fall through the _mi test", () => {
    expect("2024_10_20_chmi".endsWith("mi")).toBe(true); // the tempting shortcut…
    expect(localCycleKind("2024_10_20_chmi")).toBe("partial"); // …and why it is wrong
  });

  // Null rather than a guess: a caller that wants a default states it.
  it("returns null for anything that is not a local cycle folder", () => {
    expect(localCycleKind("2026_04_19")).toBeNull(); // parliamentary slug
    expect(localCycleKind("mi")).toBeNull();
    expect(localCycleKind("")).toBeNull();
  });
});

describe("friendly dates", () => {
  it("formats a cycle slug and an ISO date, and passes through junk", () => {
    expect(friendlyCycleDate("2024_10_20_chmi")).toBe("20.10.2024");
    expect(friendlyIsoDate("2024-10-20")).toBe("20.10.2024");
    expect(friendlyCycleDate("nope")).toBe("nope");
    expect(friendlyIsoDate("nope")).toBe("nope");
  });
});
