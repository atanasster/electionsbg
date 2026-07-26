import { describe, it, expect } from "vitest";
import { groupMethodFacet, procedureBucket } from "./cpvSectors";

describe("groupMethodFacet", () => {
  it("merges the АОП BG phrase and the ЦАИС ЕОП enum for the same procedure", () => {
    const out = groupMethodFacet([
      { value: "Открита процедура", count: 3082 },
      { value: "open", count: 196 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].bucket).toBe("open");
    expect(out[0].count).toBe(3082 + 196);
    // both raw strings preserved so the "in" filter can send them
    expect(out[0].methods.sort()).toEqual(["open", "Открита процедура"].sort());
  });

  it("sums counts across distinct buckets and orders by count desc", () => {
    const out = groupMethodFacet([
      { value: "Пряко възлагане", count: 15 },
      { value: "Открита процедура", count: 3082 },
      { value: "Публично състезание", count: 318 },
      { value: "limited", count: 9 }, // → direct bucket, folds with пряко
    ]);
    // open (3082), competition (318), direct (15 + 9)
    expect(out.map((r) => r.bucket)).toEqual(["open", "competition", "direct"]);
    const direct = out.find((r) => r.bucket === "direct");
    expect(direct?.count).toBe(15 + 9);
    expect(direct?.methods.sort()).toEqual(
      ["limited", "Пряко възлагане"].sort(),
    );
  });

  it("routes unknown/empty method strings to the unknown bucket", () => {
    expect(procedureBucket("")).toBe("unknown");
    const out = groupMethodFacet([{ value: "", count: 4 }]);
    expect(out).toEqual([{ bucket: "unknown", count: 4, methods: [""] }]);
  });

  it("returns an empty array for no rows", () => {
    expect(groupMethodFacet([])).toEqual([]);
  });
});
