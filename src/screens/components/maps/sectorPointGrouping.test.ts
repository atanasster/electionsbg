// Pure gates for SectorPointMap's grouping + spiderfy decision. The Leaflet render
// needs a DOM; this covers the co-location bucketing, busiest-first order, and the
// four interacting spread conditions (an off-by-one on spreadMax would silently
// mis-render София's whole-city stack).

import { describe, it, expect } from "vitest";
import {
  DOT_RADIUS,
  groupByLoc,
  shouldSpread,
  spreadRadius,
  SPREAD_RADIUS,
} from "./sectorPointGrouping";
import type { SectorMapPoint } from "./SectorPointMap";

// Minimal point — groupByLoc only reads `id`, `loc`, `value`.
const pt = (
  id: string,
  loc: [number, number],
  value: number,
): SectorMapPoint => ({ id, loc, value, color: "#000", badge: 1, title: id });

describe("groupByLoc", () => {
  it("buckets points sharing loc and sorts each group busiest-first", () => {
    const g = groupByLoc([
      pt("a", [23, 42], 3),
      pt("b", [23, 42], 5),
      pt("c", [24, 43], 1),
    ]);
    expect(g).toHaveLength(2);
    const shared = g.find((x) => x.length === 2)!;
    expect(shared.map((p) => p.id)).toEqual(["b", "a"]); // value 5 before 3
  });

  it("orders groups so the busiest city is last (drawn on top)", () => {
    const g = groupByLoc([pt("hi", [23, 42], 9), pt("lo", [24, 43], 1)]);
    expect(g.map((grp) => grp[0].id)).toEqual(["lo", "hi"]);
  });

  it("returns one group per unique loc", () => {
    expect(groupByLoc([])).toEqual([]);
    expect(groupByLoc([pt("only", [23, 42], 1)])).toHaveLength(1);
  });
});

describe("shouldSpread", () => {
  const base = { spreadZoom: 11, spreadMax: 12 };

  it("spreads a 3-member group at/above spreadZoom, not below", () => {
    expect(shouldSpread({ ...base, len: 3, zoom: 11 })).toBe(true);
    expect(shouldSpread({ ...base, len: 3, zoom: 12 })).toBe(true);
    expect(shouldSpread({ ...base, len: 3, zoom: 10 })).toBe(false);
  });

  it("keeps oversized stacks (София) as a pager badge", () => {
    expect(shouldSpread({ ...base, len: 157, zoom: 14 })).toBe(false);
    expect(shouldSpread({ ...base, len: 12, zoom: 14 })).toBe(true); // exactly at cap
    expect(shouldSpread({ ...base, len: 13, zoom: 14 })).toBe(false);
  });

  it("never spreads a lone unit", () => {
    expect(shouldSpread({ ...base, len: 1, zoom: 14 })).toBe(false);
  });

  it("never spreads when spreadZoom is unset or zoom unknown", () => {
    expect(
      shouldSpread({ len: 3, zoom: 14, spreadZoom: undefined, spreadMax: 12 }),
    ).toBe(false);
    expect(shouldSpread({ ...base, len: 3, zoom: null })).toBe(false);
  });
});

describe("spreadRadius", () => {
  it("keeps the base radius while it still spaces dots comfortably", () => {
    // The schools cap (spreadMax = 12) sits inside the base ring's comfort zone.
    expect(spreadRadius(2)).toBe(SPREAD_RADIUS);
    expect(spreadRadius(12)).toBe(SPREAD_RADIUS);
  });

  it("grows for larger groups so dots keep roughly constant spacing", () => {
    const r = spreadRadius(24);
    expect(r).toBeGreaterThan(SPREAD_RADIUS);
    // per-dot arc stays ≥ a dot diameter, so the fan doesn't crowd
    expect((2 * Math.PI * r) / 24).toBeGreaterThanOrEqual(DOT_RADIUS * 2);
  });
});
