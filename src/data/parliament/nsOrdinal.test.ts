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
