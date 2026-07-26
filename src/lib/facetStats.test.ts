import { describe, it, expect } from "vitest";
import { facetShare, bucketShare } from "./facetStats";
import type { MethodBucketFacet } from "./cpvSectors";

describe("facetShare", () => {
  const rows = [
    { value: "1", count: 30 },
    { value: "2", count: 50 },
    { value: "3", count: 20 },
  ];

  it("computes the share of matching rows over the total (single-bid case)", () => {
    expect(facetShare(rows, (v) => Number(v) === 1)).toBe(30); // 30/100
  });

  it("returns null when there is no denominator", () => {
    expect(facetShare([], () => true)).toBeNull();
  });

  it("returns 0 when nothing matches (distinct from null)", () => {
    expect(facetShare(rows, (v) => Number(v) === 99)).toBe(0);
  });
});

describe("bucketShare", () => {
  const grouped: MethodBucketFacet[] = [
    { bucket: "open", count: 75, methods: ["open"] },
    { bucket: "direct", count: 25, methods: ["Пряко възлагане"] },
  ];

  it("computes a bucket's share of the grouped total", () => {
    expect(bucketShare(grouped, "direct")).toBe(25);
  });

  it("returns 0 for a bucket that isn't present", () => {
    expect(bucketShare(grouped, "framework")).toBe(0);
  });

  it("returns null for an empty mix", () => {
    expect(bucketShare([], "direct")).toBeNull();
  });
});
