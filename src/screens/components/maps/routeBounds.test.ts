// Pure gate for the route map's bounds reducer (§10 P3, Tier D). The Leaflet
// render itself needs a DOM; the bounds logic — the part a refactor could silently
// break (coordinate order, the <2 degrade) — is extracted pure and tested here.

import { describe, it, expect } from "vitest";
import { routeBounds } from "./routeBounds";

describe("routeBounds", () => {
  it("spans all [lat, lng] points as [[minLat,minLng],[maxLat,maxLng]]", () => {
    expect(
      routeBounds([
        [43.0, 24.1],
        [42.7, 23.3],
        [43.4, 25.9],
      ]),
    ).toEqual([
      [42.7, 23.3],
      [43.4, 25.9],
    ]);
  });

  it("returns null for a line too short to draw (<2 points)", () => {
    expect(routeBounds([])).toBeNull();
    expect(routeBounds([[42.7, 23.3]])).toBeNull();
  });

  it("handles a 2-point line (min = first-or-second per axis)", () => {
    expect(
      routeBounds([
        [42.7, 25.9],
        [43.4, 23.3],
      ]),
    ).toEqual([
      [42.7, 23.3],
      [43.4, 25.9],
    ]);
  });
});
