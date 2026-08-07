import { describe, it, expect } from "vitest";
import { pgTextArray } from "./copy";

// These are the two escape layers a `text[]` value crosses on the way into
// Postgres: the array literal, then the COPY stream. Getting the ORDER wrong is
// silent — the value arrives shorter, not rejected.
describe("pgTextArray", () => {
  it("quotes every element, so a comma does not split one value into two", () => {
    expect(pgTextArray(["A,B"])).toBe('{"A,B"}');
    expect(pgTextArray(["A", "B"])).toBe('{"A","B"}');
  });

  it("keeps the literal string NULL a value, not a NULL element", () => {
    expect(pgTextArray(["NULL"])).toBe('{"NULL"}');
  });

  it("escapes a double quote", () => {
    expect(pgTextArray(['A"B'])).toBe('{"A\\"B"}');
  });

  // The bug this helper exists for: a lone backslash survived the array literal
  // and was then eaten by the array parser, so `A\B` stored as `AB` — silently.
  it("escapes a backslash, backslash-first", () => {
    expect(pgTextArray(["A\\B"])).toBe('{"A\\\\B"}');
    // Both together: the backslash must be doubled BEFORE the quote is escaped,
    // or the quote's own backslash gets doubled too.
    expect(pgTextArray(['A\\"B'])).toBe('{"A\\\\\\"B"}');
  });

  it("passes braces and whitespace through unharmed", () => {
    expect(pgTextArray(["A{B}"])).toBe('{"A{B}"}');
    expect(pgTextArray(["Bosnia and Herzegovina"])).toBe(
      '{"Bosnia and Herzegovina"}',
    );
  });

  it("renders an empty array as an empty array, not as NULL", () => {
    expect(pgTextArray([])).toBe("{}");
  });
});
