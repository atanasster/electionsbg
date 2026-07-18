import { describe, it, expect } from "vitest";
import { parseAmount } from "./parse_amount";

describe("parseAmount (FINDING-020)", () => {
  it("parses a plain dot-decimal amount (the actual СЕУ format)", () => {
    expect(parseAmount("2604264.9")).toBe(2604264.9);
    expect(parseAmount("3810450.32")).toBe(3810450.32);
  });

  it("treats a lone comma as the decimal separator", () => {
    expect(parseAmount("1234,56")).toBe(1234.56);
  });

  it("parses BG/EU format (dot=thousands, comma=decimal) — previously NaN→0", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1.234.567,89")).toBe(1234567.89);
  });

  it("parses US format (comma=thousands, dot=decimal)", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("1,234,567.89")).toBe(1234567.89);
  });

  it("strips ordinary and non-breaking spaces", () => {
    expect(parseAmount("1 234,56")).toBe(1234.56);
    expect(parseAmount("1 234 567,89")).toBe(1234567.89);
  });

  it("returns 0 for null, empty, and non-numeric input", () => {
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("   ")).toBe(0);
    expect(parseAmount("n/a")).toBe(0);
  });

  it("passes through native numbers", () => {
    expect(parseAmount(1234.56)).toBe(1234.56);
    expect(parseAmount(0)).toBe(0);
  });
});
