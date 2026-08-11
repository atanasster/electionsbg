import { describe, expect, it } from "vitest";
import { nsOrdinal } from "./nsOrdinal";

describe("nsOrdinal", () => {
  // The four suffixes this corpus actually reaches. „-то" everywhere — the shortcut this
  // helper exists to replace — is wrong for exactly the two parliaments in the news.
  it.each([
    ["44", "44-то"],
    ["46", "46-то"],
    ["47", "47-мо"],
    ["48", "48-мо"],
    ["49", "49-то"],
    ["50", "50-то"],
    ["51", "51-во"],
    ["52", "52-ро"],
    // Teens are „-то" throughout and must beat the last-digit rule: without the guard 11
    // reads „11-во", 12 „12-ро" and 17/18 „-мо". Unreachable for an NS number, pinned
    // because the English branch has always had the same guard.
    ["11", "11-то"],
    ["12", "12-то"],
    ["17", "17-то"],
    ["111", "111-то"],
    // ...and the guard must not swallow the plain cases that share a last digit.
    ["21", "21-во"],
    ["22", "22-ро"],
  ])("bg %s → %s", (ns, expected) => {
    expect(nsOrdinal(ns, "bg")).toBe(expected);
  });

  it.each([
    ["44", "44th"],
    ["51", "51st"],
    ["52", "52nd"],
    ["53", "53rd"],
  ])("en %s → %s", (ns, expected) => {
    expect(nsOrdinal(ns, "en")).toBe(expected);
  });

  it("passes a non-numeric value through rather than printing NaN", () => {
    expect(nsOrdinal("", "bg")).toBe("");
    expect(nsOrdinal("x", "bg")).toBe("x");
  });
});
