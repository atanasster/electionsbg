import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_TOLERANCE,
  FRAME_H,
  FRAME_PAD,
  FRAME_W,
  MIN_RING_AREA_PX2,
  parseCliArgs,
  parseLoc,
  projectCommittedRegions,
  projectRegions,
  ringArea,
  simplifyPolyline,
  simplifyRing,
  type Pt,
} from "./project_regions";
import { OBLAST_CODES } from "../db/gen_home/oblastCodes";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/**
 * ⚠️ WINDING IS LOAD-BEARING IN A FIXTURE, and it is the opposite of the planar intuition.
 * d3-geo reads a lon/lat ring on the sphere, so an exterior ring must go north-then-east
 * (clockwise in the x-east/y-north sense). Wound the other way it is the COMPLEMENT:
 * measured, `geoArea` comes back 12.562 sr against the sphere's 12.566 and `geoBounds` is
 * `[[-180,-90],[180,90]]`, so `fitExtent` fits the whole globe and a fixture meant to be
 * Bulgaria-sized becomes a ~35 px² speck at a 100x-off scale — after which the test still
 * throws, for a reason nobody wrote down.
 */
const mkFeature = (nuts3: string, ring: number[][]) => ({
  type: "Feature" as const,
  properties: { nuts3 },
  geometry: { type: "Polygon" as const, coordinates: [ring] },
});

/** A Bulgaria-sized neighbour, so `fitExtent` derives a realistic scale. */
const BULGARIA_BOX: number[][] = [
  [22, 41],
  [22, 44],
  [28, 44],
  [28, 41],
  [22, 41],
];

const sourceKeys = (): string[] => {
  const fc = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/regions_map.json"), "utf8"),
  ) as { features: { properties: { nuts3: string } }[] };
  return fc.features.map((f) => f.properties.nuts3);
};

describe("simplifyPolyline", () => {
  it("keeps both endpoints and drops what is within tolerance of the chord", () => {
    const line: Pt[] = [
      [0, 0],
      [5, 0.4],
      [10, 0],
    ];
    expect(simplifyPolyline(line, 1)).toEqual([
      [0, 0],
      [10, 0],
    ]);
    expect(simplifyPolyline(line, 0.1)).toEqual(line);
  });

  it("is a no-op on two points", () => {
    const line: Pt[] = [
      [0, 0],
      [1, 1],
    ];
    expect(simplifyPolyline(line, 99)).toEqual(line);
  });
});

describe("simplifyRing", () => {
  it("does NOT collapse a closed ring — the whole reason it is not simplifyPolyline", () => {
    // The chord from the first point back to itself has zero length, so a plain
    // Douglas-Peucker over a closed ring keeps two points and erases the shape.
    const square: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ];
    const out = simplifyRing(square, 1);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out[0]).toEqual(out[out.length - 1]);
    // Every corner survives: none of them is within 1px of a chord between the others.
    for (const corner of square.slice(0, 4)) {
      expect(out.some((p) => p[0] === corner[0] && p[1] === corner[1])).toBe(
        true,
      );
    }
  });

  it("drops a vertex that is within tolerance of its neighbours' chord", () => {
    const square: Pt[] = [
      [0, 0],
      [50, 0.5],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ];
    const out = simplifyRing(square, 2);
    expect(out.some((p) => p[0] === 50)).toBe(false);
    expect(out).toHaveLength(5);
  });

  it("closes a ring that arrives open", () => {
    const open: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const out = simplifyRing(open, 0.1);
    expect(out[0]).toEqual(out[out.length - 1]);
  });
});

describe("projectRegions over the committed geometry", () => {
  const { geo, stats } = projectCommittedRegions();

  it("carries exactly the 31 МИР of data/regions_map.json", () => {
    expect(Object.keys(geo.regions).sort()).toEqual([...sourceKeys()].sort());
    expect(Object.keys(geo.regions)).toHaveLength(31);
  });

  it("emits key-sorted regions, so two runs of one corpus are byte-identical", () => {
    const keys = Object.keys(geo.regions);
    expect(keys).toEqual([...keys].sort());
    const again = projectCommittedRegions();
    expect(JSON.stringify(again.geo)).toBe(JSON.stringify(geo));
  });

  it("closes every ring and keeps every coordinate an integer inside the frame", () => {
    for (const [key, region] of Object.entries(geo.regions)) {
      expect(region.rings.length, key).toBeGreaterThan(0);
      for (const ring of region.rings) {
        expect(ring.length, key).toBeGreaterThanOrEqual(4);
        expect(ring[0], key).toEqual(ring[ring.length - 1]);
        for (const [x, y] of ring) {
          expect(Number.isInteger(x) && Number.isInteger(y), key).toBe(true);
          expect(x, key).toBeGreaterThanOrEqual(FRAME_PAD * 10);
          expect(x, key).toBeLessThanOrEqual((FRAME_W - FRAME_PAD) * 10);
          expect(y, key).toBeGreaterThanOrEqual(FRAME_PAD * 10);
          expect(y, key).toBeLessThanOrEqual((FRAME_H - FRAME_PAD) * 10);
        }
      }
    }
  });

  it("keeps Русе's two polygons and Стара Загора's exclave", () => {
    // Both are second polygons of a MultiPolygon — 87.5 px² and 3.3 px² respectively. A
    // point-count rule would delete the second; the area rule keeps it.
    expect(geo.regions.RSE.rings).toHaveLength(2);
    expect(geo.regions.SZR.rings).toHaveLength(2);
  });

  it("drops the source's degenerate slivers, and only those", () => {
    // Ten features carry 4-5-point rings of 0.02-0.03 px². 14 rings in total.
    expect(stats.droppedRings).toBe(14);
    expect(MIN_RING_AREA_PX2).toBeLessThan(3.32); // Стара Загора's real exclave
  });

  it("folds Sofia's three МИР onto one oblast and Plovdiv's two onto another", () => {
    for (const k of ["S23", "S24", "S25"]) {
      expect(geo.regions[k].oblast, k).toBe("SOF");
    }
    expect(geo.regions.PDV.oblast).toBe("PDV");
    expect(geo.regions["PDV-00"].oblast).toBe("PDV");
    expect(geo.regions.SFO.oblast).toBe("SFO");
    expect(new Set(Object.values(geo.regions).map((r) => r.oblast)).size).toBe(
      28,
    );
  });

  it("anchors all 28 oblast columns, with a name in both languages", () => {
    expect(Object.keys(geo.cities).sort()).toEqual([...OBLAST_CODES]);
    for (const [code, [x, y, bg, en]] of Object.entries(geo.cities)) {
      expect(Number.isInteger(x) && Number.isInteger(y), code).toBe(true);
      expect(x, code).toBeGreaterThan(0);
      expect(x, code).toBeLessThan(FRAME_W * 10);
      expect(y, code).toBeGreaterThan(0);
      expect(y, code).toBeLessThan(FRAME_H * 10);
      expect(bg.length, code).toBeGreaterThan(2);
      expect(en.length, code).toBeGreaterThan(2);
    }
  });

  it("stands Sofia's column at the city, not at the S23 centroid", () => {
    // Plan §14. The frame is ~0.54 km per pixel, so the ~10 km offset the plan describes is
    // ~19 px — an obvious displacement, and exactly the kind that is invisible in review.
    const [cityX, cityY] = geo.cities.SOF;
    const [mirX, mirY] = geo.regions.S23.c;
    const dy = (mirY - cityY) / 10;
    expect(dy).toBeGreaterThan(10); // the МИР centroid is well SOUTH of the city
    expect(Math.abs(mirX - cityX) / 10).toBeLessThan(dy); // and only slightly east
  });

  it("keeps Sofia city and Sofia province apart on the map, as well as in the codes", () => {
    const [sofX, sofY] = geo.cities.SOF;
    const [sfoX, sfoY] = geo.cities.SFO;
    expect(Math.hypot(sofX - sfoX, sofY - sfoY) / 10).toBeGreaterThan(20);
  });

  it("reports what it cost", () => {
    expect(stats.tolerance).toBe(DEFAULT_TOLERANCE);
    expect(stats.sourcePoints).toBeGreaterThan(17_000);
    expect(stats.points).toBeLessThan(stats.sourcePoints / 5);
    // The artifact's whole budget is 48 KiB and the geometry is the largest block in it.
    expect(stats.bytes).toBeLessThan(28_000);
  });

  it("caps the tolerance per ring, so a small exclave is not simplified for a big oblast", () => {
    // Measured 2026-09-05: the cap binds on 1 of 33 kept rings — it can only bind below
    // (4 * 1.9)^2 = 57.8 px^2 — and Стара Загора's 3.32 px^2 exclave is the only one under
    // it. Русе's 87.5 px^2 ring is deliberately NOT a case: sqrt(87.53)/4 = 2.34 > 1.9.
    const toPx = (ring: number[][]): Pt[] =>
      ring.map(([x, y]) => [x / 10, y / 10] as Pt);
    const exclave = geo.regions.SZR.rings
      .map(toPx)
      .reduce((a, b) => (ringArea(a) < ringArea(b) ? a : b));
    expect(exclave.length).toBeGreaterThan(4);
    expect(ringArea(exclave)).toBeGreaterThan(3.3);

    // Mutation check: the assertions above must FAIL on an UNCAPPED implementation, or they
    // are equally satisfied by a build that silently stopped capping. Re-simplifying the kept
    // ring at the flat tolerance is the closest stand-in for that build.
    const flat = simplifyRing(exclave, DEFAULT_TOLERANCE);
    expect(flat.length).toBeLessThan(exclave.length);
    expect(ringArea(flat)).toBeLessThan(3.3);
  });

  it("simplifies harder at a coarser tolerance and less at a finer one", () => {
    const coarse = projectCommittedRegions({ tolerance: 4 });
    const fine = projectCommittedRegions({ tolerance: 0.5 });
    expect(coarse.stats.points).toBeLessThan(stats.points);
    expect(fine.stats.points).toBeGreaterThan(stats.points);
    // Whatever the tolerance, the corpus is never silently reduced to fewer places.
    expect(Object.keys(coarse.geo.regions)).toHaveLength(31);
    expect(coarse.geo.regions.RSE.rings).toHaveLength(2);
  });
});

describe("projectRegions refusals", () => {
  it("refuses a МИР it cannot fold to an oblast", () => {
    const fc = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          properties: { nuts3: "XXX" },
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              [
                [23, 42],
                [24, 42],
                [24, 43],
                [23, 42],
              ],
            ],
          },
        },
      ],
    };
    expect(() => projectRegions(fc)).toThrow(/folds to no oblast/);
  });

  it("refuses a feature whose every ring is a sliver", () => {
    // The scale comes from the whole collection, so the sliver has to be microscopic
    // RELATIVE to a real neighbour — a lone tiny polygon would simply be fitted to the frame.
    const fc = {
      type: "FeatureCollection" as const,
      features: [
        mkFeature("BLG", BULGARIA_BOX),
        mkFeature("S23", [
          [23, 42],
          [23, 42.000001],
          [23.000001, 42.000001],
          [23.000001, 42],
          [23, 42],
        ]),
      ],
    };
    // Name the FEATURE, not just the shape: with the rings wound the other way `fitExtent`
    // fits the globe and BLG itself becomes a speck, at which point a bare /kept no ring/
    // passes while testing the wrong feature entirely.
    expect(() => projectRegions(fc)).toThrow(/S23 kept no ring/);
  });

  it("refuses a ring that is real by area but too thin to quantize", () => {
    // A ring can clear MIN_RING_AREA_PX2 and still collapse: `quantize` rounds to tenths, so
    // anything under 0.05 px wide lands on a line, and the fallback re-runs the SAME rounding
    // and cannot rescue it. Measured before the guard: [[2008,4172],[7244,4172],[2008,4172]] —
    // a zero-area segment shipped as a polygon.
    const fc = {
      type: "FeatureCollection" as const,
      features: [
        mkFeature("BLG", BULGARIA_BOX),
        mkFeature("SZR", [
          [23, 42],
          [23, 42.00002],
          [26.5, 42.00002],
          [26.5, 42],
          [23, 42],
        ]),
      ],
    };
    expect(() => projectRegions(fc)).toThrow(/thinner than 0\.05 px/);
  });

  it("refuses a source that carries one МИР twice", () => {
    const fc = {
      type: "FeatureCollection" as const,
      features: [
        mkFeature("BLG", BULGARIA_BOX),
        mkFeature("BLG", BULGARIA_BOX),
      ],
    };
    expect(() => projectRegions(fc)).toThrow(/twice/);
  });

  it("refuses a collection whose missing `type` discriminators defeat fitExtent", () => {
    // Measured: without them `fitExtent` derives scale -0 and every coordinate is NaN — which
    // slips past the sliver guard (`NaN < 0.5` is false) and would make every per-ring
    // tolerance NaN, i.e. recurse for ever rather than fail.
    const fc = JSON.parse(
      fs.readFileSync(path.join(ROOT, "data/regions_map.json"), "utf8"),
    );
    delete fc.type;
    for (const f of fc.features) delete f.type;
    expect(() => projectRegions(fc)).toThrow(
      /does not project to a finite point/,
    );
  });

  it("refuses a NaN tolerance rather than recursing for ever", () => {
    // Douglas-Peucker's `worst <= tol` is FALSE for NaN, so the recursion never bottoms out
    // and the failure arrives as a stack overflow with no mention of the tolerance.
    expect(() => projectCommittedRegions({ tolerance: Number.NaN })).toThrow(
      /tolerance/,
    );
    expect(() => projectCommittedRegions({ tolerance: -1 })).toThrow(
      /tolerance/,
    );
  });
});

describe("parseLoc", () => {
  it("accepts exactly two finite numbers", () => {
    expect(parseLoc("23.3,42.7", "x")).toEqual([23.3, 42.7]);
  });

  it("refuses anything else, rather than half-reading it", () => {
    // A truncated `loc` read as one number would put an oblast's column at longitude NaN,
    // which the projection guard then reports as a corrupt map rather than a corrupt anchor.
    for (const bad of ["23.3", "23.3,42.7,1", "", "a,b", ",", undefined]) {
      expect(() => parseLoc(bad, "x"), String(bad)).toThrow(/no usable loc/);
    }
  });
});

describe("parseCliArgs", () => {
  it("defaults the tolerance and writes nothing", () => {
    expect(parseCliArgs([])).toEqual({ tolerance: DEFAULT_TOLERANCE });
  });

  it("reads both flags", () => {
    expect(parseCliArgs(["--tolerance", "4", "--out", "a/b.json"])).toEqual({
      tolerance: 4,
      out: "a/b.json",
    });
  });

  it("refuses a flag with no value, rather than looking like a successful run", () => {
    // `--tolerance` last would otherwise run at the default and report success, and a
    // trailing `--out` would write nothing at exit 0.
    expect(() => parseCliArgs(["--tolerance"])).toThrow(/needs a value/);
    expect(() => parseCliArgs(["--out"])).toThrow(/needs a value/);
    expect(() => parseCliArgs(["--tolerance", "--out", "x"])).toThrow(
      /needs a value/,
    );
  });

  it("refuses a tolerance that is not a non-negative number", () => {
    expect(() => parseCliArgs(["--tolerance", "abc"])).toThrow(/tolerance/);
    expect(() => parseCliArgs(["--tolerance", "-1"])).toThrow(/tolerance/);
  });
});
