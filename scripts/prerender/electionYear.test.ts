import { describe, it, expect } from "vitest";
import { electionYearSuffix } from "./electionYear";

describe("electionYearSuffix", () => {
  it("extracts the leading year from an election folder name", () => {
    expect(electionYearSuffix("2026_04_19")).toBe(" 2026");
    expect(electionYearSuffix("2005_06_25")).toBe(" 2005");
  });

  it("returns an empty string when the year is missing or malformed", () => {
    // A missing/unreadable elections file collapses to "" upstream — the suffix
    // must then be empty so titles read "Парламентарни избори — резултати …"
    // with no dangling space or year.
    expect(electionYearSuffix("")).toBe("");
    expect(electionYearSuffix(null)).toBe("");
    expect(electionYearSuffix(undefined)).toBe("");
    // Local-cycle slugs and other non-year-leading names must not leak through.
    expect(electionYearSuffix("mi_2023")).toBe("");
    expect(electionYearSuffix("abcd_10_20")).toBe("");
  });
});
