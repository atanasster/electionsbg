import { describe, it, expect } from "vitest";
import { unpinnedOperators } from "./unpinnedOperators";

const op = (eik: string, contractCount: number) => ({
  eik,
  name: `op ${eik}`,
  totalEur: 100,
  contractCount,
});

describe("unpinnedOperators", () => {
  it("names active operators the map did not place", () => {
    expect(
      unpinnedOperators([op("1", 3), op("2", 5)], ["1"], true).map(
        (o) => o.eik,
      ),
    ).toEqual(["2"]);
  });

  it("says nothing until the map has answered", () => {
    expect(unpinnedOperators([op("1", 3)], [], false)).toEqual([]);
    expect(unpinnedOperators([op("1", 3)], ["9"], false)).toEqual([]);
  });

  it("says nothing when the map returned no points at all", () => {
    expect(unpinnedOperators([op("1", 3)], [], true)).toEqual([]);
  });

  it("ignores operators with no contract in the window", () => {
    expect(unpinnedOperators([op("1", 0)], ["9"], true)).toEqual([]);
  });
});
