// Bulgaria's 31 МИР polygons, projected ONCE at generation time into the flyover's planar
// frame — `docs/plans/home-flyover-v1.md` §0.1 and §6.1.
//
//   npx tsx scripts/geo/project_regions.ts [--tolerance 1.9] [--out data/home/_geo.json]
//
// ⚠️ THE POINT OF PROJECTING OFFLINE IS THAT THE CLIENT NEVER IMPORTS `d3-geo`. `/` is the
// site's entry page and is budgeted in REQUESTS and BYTES (two GCS requests at first paint,
// an 18,000-character HTML ceiling, no `vendor-geo`/`vendor-leaflet`/`vendor-charts` in the
// home chunk — `MAP_FREE_HUBS` in tests/perf.spec.ts). A projection running in the browser
// would pull a map library onto that page for arithmetic that has exactly one answer and
// never changes. So the answer is computed here, quantized, and shipped as integers.
//
// The frame is 1000×625 and every coordinate is an INTEGER TENTH of a frame pixel — 0.1 px
// at the widest the band is ever drawn, i.e. below what any display can resolve, at a third
// of the bytes a float costs in JSON.
//
// Two rules about this file that are easy to get backwards:
//
//   - **A flat tolerance over-simplifies a small ring, though it never ERASES one.**
//     `simplifyRing` cannot reduce a ring below three distinct points — it cuts at the
//     farthest vertex and each half keeps its endpoints — so the risk here is fidelity, not
//     deletion. At a flat 1.9 px Стара Загора's 3.32 px² exclave comes back as a 4-point
//     triangle of 3.21 px²; capped at √area/4 it is 6 points and 3.45 px². Measured
//     2026-09-05, the cap binds on 1 of 33 kept rings (it can only bind below (4 × 1.9)² =
//     57.8 px²) and costs 2 points corpus-wide, 1,908 → 1,910. ⚠️ Русе's 87.5 px² second
//     polygon is UNAFFECTED by it — √87.53/4 = 2.34 > 1.9 — despite being the obvious
//     example to reach for.
//   - **A ring being tiny is not the same as a ring being an artifact.** Ten of the 31
//     features carry 4–5-point rings measuring 0.02 px² — degenerate slivers in the source,
//     not places — and they are dropped by AREA, with the count reported. A point-count rule
//     is the wrong discriminator in both directions: applied BEFORE simplification it misses
//     nothing but proves nothing (Стара Загора's real exclave carries 12 points there), and
//     applied AFTER it would delete Русе's 87.5 px² polygon, which simplifies to 5.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  geoMercator,
  type ExtendedFeature,
  type ExtendedFeatureCollection,
} from "d3-geo";
import type { MultiPolygon, Polygon } from "geojson";
import {
  OBLAST_CODES,
  oblastFromCode,
  oblastRec,
} from "../db/gen_home/oblastCodes";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** The planar frame every flyover coordinate lives in. */
export const FRAME_W = 1000;
export const FRAME_H = 625;

/**
 * Inset, in frame pixels, so no polygon touches the frame edge. `d3_utils.getDataProjection`
 * uses a 0.95 scale factor for the same reason; this is the `fitExtent` spelling of it.
 */
export const FRAME_PAD = 8;

/**
 * Douglas–Peucker tolerance in frame pixels.
 *
 * ⚠️ Measured on THIS implementation, 2026-09-05: 1.9 px → 17,814 source points become 1,910,
 * and the whole `geo` block is **25,625 bytes** — 52% of the artifact's 48 KiB budget, leaving
 * step 3 about 23 KB for the layers, the flow matrix and the caption figures. The plan's §0.1
 * quotes ~17 KB; that was the concept prototype, whose ring simplifier could collapse a closed
 * ring, and it is 51% low against what this file emits. Budget against the number here.
 */
export const DEFAULT_TOLERANCE = 1.9;

/**
 * Below this a ring cannot be drawn at all at 1000×625 — it is a source artifact rather
 * than a place. Measured: the degenerate rings are 0.02–0.03 px², the smallest REAL polygon
 * (Стара Загора's exclave) is 3.32 px², so the threshold sits two orders of magnitude clear
 * of the thing it must not delete.
 */
export const MIN_RING_AREA_PX2 = 0.5;

/** A point in the planar frame, in frame PIXELS — not yet tenths. */
export type Pt = [number, number];

/** One МИР polygon in the frame. Coordinates are integer TENTHS of a frame pixel. */
export interface FlyoverRegion {
  /** The money-grain oblast this МИР belongs to (three Sofia МИР share one). */
  oblast: string;
  /** Closed rings — `rings[i][0]` equals `rings[i].at(-1)`. */
  rings: number[][][];
  /** Label / depth-sort point: the area-weighted centroid of the largest ring. */
  c: [number, number];
}

/** `[x, y, nameBg, nameEn]` — where an oblast's column stands, and what it is called. */
export type FlyoverCity = [number, number, string, string];

export interface FlyoverGeo {
  frame: { w: number; h: number };
  regions: Record<string, FlyoverRegion>;
  cities: Record<string, FlyoverCity>;
}

export interface ProjectStats {
  tolerance: number;
  /** Points in the source geometry, before simplification. */
  sourcePoints: number;
  /** Points kept, i.e. what the artifact pays for. */
  points: number;
  /** Rings dropped for being below `MIN_RING_AREA_PX2`. */
  droppedRings: number;
  /**
   * JSON bytes of the `geo` block plus `frame` (~30 B), which the artifact hoists to its own
   * top level — so this is a hair over what the block costs there.
   */
  bytes: number;
}

/**
 * ⚠️ The GeoJSON `type` discriminators are REQUIRED, not decorative. `geoMercator().fitExtent`
 * reads its argument through the GeoJSON stream, which recognises nothing without them:
 * measured, `scale` comes back as `-0` and every coordinate projects to NaN. `project()` below
 * is what turns that into a message rather than a corpus of NaN.
 *
 * These are d3-geo's own types rather than local look-alikes, so `fitExtent` takes the
 * collection directly — an `as unknown as` pair there would switch the checker off at exactly
 * the call this file's hardest failure comes through.
 */
type Feature = ExtendedFeature<Polygon | MultiPolygon, { nuts3: string }>;
type FeatureCollection = ExtendedFeatureCollection<Feature>;

const ringsOf = (f: Feature): number[][][] =>
  f.geometry.type === "Polygon"
    ? f.geometry.coordinates
    : f.geometry.coordinates.flat();

/** The tolerance guard, shared, because a NaN one does not terminate — see `projectRegions`. */
const assertTolerance = (tol: number): void => {
  if (!Number.isFinite(tol) || tol < 0) {
    throw new Error(
      `project_regions: tolerance ${tol} is not a non-negative number`,
    );
  }
};

/** Twice the signed area of a closed ring (the shoelace sum). */
const shoelace = (ring: readonly Pt[]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum;
};

/** Unsigned area of a closed ring, in the units its coordinates are in. */
export const ringArea = (ring: readonly Pt[]): number =>
  Math.abs(shoelace(ring) / 2);

/**
 * Area-weighted centroid of a closed ring. Falls back to the arithmetic mean of the vertices
 * when the ring has no area, which is the only case where the formula divides by zero.
 */
const ringCentroid = (ring: readonly Pt[]): Pt => {
  const a2 = shoelace(ring);
  if (a2 === 0) {
    const n = ring.length - 1 || 1;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sx += ring[i][0];
      sy += ring[i][1];
    }
    return [sx / n, sy / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    cx += (ring[i][0] + ring[i + 1][0]) * cross;
    cy += (ring[i][1] + ring[i + 1][1]) * cross;
  }
  return [cx / (3 * a2), cy / (3 * a2)];
};

/** Perpendicular distance from `p` to the segment `a`–`b`. */
const perpDistance = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (a[0] + clamped * dx), p[1] - (a[1] + clamped * dy));
};

/**
 * Douglas–Peucker over an OPEN polyline; both endpoints are always kept.
 *
 * @param tol must be finite and non-negative. A NaN tolerance does NOT terminate — `worst <=
 * tol` is false for ever, so the recursion never bottoms out — and callers outside this module
 * are responsible for the check (`projectRegions` makes it via `assertTolerance`).
 */
export const simplifyPolyline = (pts: readonly Pt[], tol: number): Pt[] => {
  if (pts.length <= 2) return [...pts];
  let worst = -1;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDistance(pts[i], pts[0], pts[pts.length - 1]);
    if (d > worst) {
      worst = d;
      idx = i;
    }
  }
  if (worst <= tol) return [pts[0], pts[pts.length - 1]];
  const left = simplifyPolyline(pts.slice(0, idx + 1), tol);
  const right = simplifyPolyline(pts.slice(idx), tol);
  return left.slice(0, -1).concat(right);
};

/**
 * Douglas–Peucker over a CLOSED ring.
 *
 * ⚠️ Running the open-polyline form on a ring whose first and last point coincide collapses
 * it to two points, because the "farthest from the chord" test measures against a chord of
 * length zero. The ring is therefore cut at the vertex farthest from its first point and the
 * two halves are simplified independently, which keeps both anchors and cannot degenerate.
 *
 * @param tol must be finite and non-negative — see `simplifyPolyline`.
 */
export const simplifyRing = (ring: readonly Pt[], tol: number): Pt[] => {
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const open = closed ? ring.slice(0, -1) : [...ring];
  if (open.length < 4) return [...open, open[0]];
  let far = 1;
  let best = -1;
  for (let i = 1; i < open.length; i++) {
    const d = (open[i][0] - open[0][0]) ** 2 + (open[i][1] - open[0][1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplifyPolyline(open.slice(0, far + 1), tol);
  const b = simplifyPolyline([...open.slice(far), open[0]], tol);
  return a.slice(0, -1).concat(b);
};

/** Round to integer tenths of a frame pixel and drop points the rounding made identical. */
const quantize = (ring: readonly Pt[]): number[][] => {
  const out: number[][] = [];
  for (const [x, y] of ring) {
    const q = [Math.round(x * 10), Math.round(y * 10)];
    const last = out[out.length - 1];
    if (last && last[0] === q[0] && last[1] === q[1]) continue;
    out.push(q);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    out.push([first[0], first[1]]);
  }
  return out;
};

interface RegionsJsonRec {
  oblast: string;
  loc?: string;
}

interface MunicipalityRec {
  obshtina: string;
  loc?: string;
}

/** `"lon,lat"` → a point, refusing anything that is not exactly two finite numbers. */
export const parseLoc = (loc: string | undefined, what: string): Pt => {
  const parts = (loc ?? "").split(",");
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  // ⚠️ The blank test is not redundant: `Number("")` is 0 and finite, so a bare "," would
  // otherwise parse as lon 0 / lat 0 — the Gulf of Guinea, drawn as a column off the map.
  if (
    parts.length !== 2 ||
    parts.some((x) => x.trim() === "") ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat)
  ) {
    throw new Error(
      `project_regions: ${what} has no usable loc (${loc ?? "missing"})`,
    );
  }
  return [lon, lat];
};

/**
 * Where each oblast's column stands, in lon/lat, DERIVED from committed files.
 *
 * 26 of the 28 take the МИР anchor in `src/data/json/regions.json`, which is the oblast
 * capital. Two cannot:
 *
 *   - **SOF** has no entry there at all — Sofia city is three МИР — and §14 of the plan is
 *     explicit that its column must stand at the CITY: the S23 centroid is ~10 km south of
 *     it. The anchor is rayon Средец from `data/municipalities.json`, the central district
 *     holding the government quarter, so the point is derived rather than typed in.
 *   - **PDV**'s own МИР anchor is the province's label point; the oblast seat is Plovdiv
 *     city, which is the separate `PDV-00` МИР.
 *
 * SFO deliberately keeps its province point. Sofia province's administrative seat IS Sofia
 * city, so using the seat would stack its column on top of the capital's — two columns, one
 * pixel, and the larger hides the smaller.
 */
export const oblastAnchorsLonLat = (): Record<string, Pt> => {
  const regions: RegionsJsonRec[] = JSON.parse(
    fs.readFileSync(path.join(ROOT, "src/data/json/regions.json"), "utf8"),
  );
  const munis: MunicipalityRec[] = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/municipalities.json"), "utf8"),
  );
  const byMir = new Map(regions.map((r) => [r.oblast, r]));
  const sredets = munis.find((m) => m.obshtina === "S2401");
  if (!sredets) {
    throw new Error(
      "project_regions: data/municipalities.json has no S2401 (Средец) — the Sofia city anchor",
    );
  }

  const out: Record<string, Pt> = {};
  for (const code of OBLAST_CODES) {
    if (code === "SOF") {
      out[code] = parseLoc(sredets.loc, "S2401 (Средец)");
      continue;
    }
    const key = code === "PDV" ? "PDV-00" : code;
    const rec = byMir.get(key);
    if (!rec) {
      throw new Error(
        `project_regions: src/data/json/regions.json has no МИР ${key} for oblast ${code}`,
      );
    }
    out[code] = parseLoc(rec.loc, `МИР ${key}`);
  }
  return out;
};

export interface ProjectOptions {
  tolerance?: number;
}

/**
 * Project + simplify + quantize. Pure over its inputs: the same file and tolerance always
 * produce byte-identical output, which is what lets the artifact be compared to the live
 * object (`db:check-generated`).
 */
export const projectRegions = (
  fc: FeatureCollection,
  opts: ProjectOptions = {},
): { geo: FlyoverGeo; stats: ProjectStats } => {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE;
  // A NaN tolerance is not merely wrong, it does not terminate: Douglas-Peucker's
  // `worst <= tol` test is false for NaN, so it recurses on the whole polyline for ever.
  assertTolerance(tolerance);
  const projection = geoMercator().fitExtent(
    [
      [FRAME_PAD, FRAME_PAD],
      [FRAME_W - FRAME_PAD, FRAME_H - FRAME_PAD],
    ],
    fc,
  );
  const project = (lon: number, lat: number): Pt => {
    const p = projection([lon, lat]);
    // A non-finite result means `fitExtent` could not derive a scale — a geometry with no
    // extent, or a corrupt coordinate. Left alone it propagates NaN into the ring areas,
    // where `NaN < MIN_RING_AREA_PX2` is FALSE, so the sliver guard waves it through and the
    // per-ring tolerance becomes NaN. Fail here, where the cause is still visible.
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new Error(
        `project_regions: ${lon},${lat} does not project to a finite point`,
      );
    }
    return [p[0], p[1]];
  };

  const regions: Record<string, FlyoverRegion> = {};
  let sourcePoints = 0;
  let points = 0;
  let droppedRings = 0;

  // Key-sorted so two runs of one corpus are byte-identical.
  const features = [...fc.features].sort((a, b) =>
    a.properties.nuts3 < b.properties.nuts3
      ? -1
      : a.properties.nuts3 > b.properties.nuts3
        ? 1
        : 0,
  );

  for (const f of features) {
    const key = f.properties?.nuts3 ?? "";
    if (regions[key]) {
      // Last-wins would drop a polygon with nothing reporting it, while `sourcePoints` still
      // counted both — every other disagreement in this file refuses rather than picks.
      throw new Error(`project_regions: the source carries МИР ${key} twice`);
    }
    const oblast = oblastFromCode(key);
    if (!oblast) {
      throw new Error(
        `project_regions: МИР ${key} folds to no oblast — see scripts/db/gen_home/oblastCodes.ts`,
      );
    }
    const kept: number[][][] = [];
    let largest: { area: number; ring: Pt[] } | null = null;
    for (const raw of ringsOf(f)) {
      sourcePoints += raw.length;
      const projected = raw.map(([lon, lat]) => project(lon, lat));
      const area = ringArea(projected);
      if (area < MIN_RING_AREA_PX2) {
        droppedRings++;
        continue;
      }
      // Cap the tolerance at a quarter of the ring's own scale, so a 3 px² exclave is not
      // simplified by a tolerance chosen for a 26,000 px² oblast.
      const ringTol = Math.min(tolerance, Math.sqrt(area) / 4);
      const simplified = simplifyRing(projected, ringTol);
      const quantized = quantize(simplified);
      // 4 = three distinct vertices plus the closing repeat.
      const ring = quantized.length >= 4 ? quantized : quantize(projected);
      // ⚠️ That fallback re-runs the SAME rounding, so it cannot rescue a ring thinner than
      // 0.05 px: such a ring collapses onto a line and comes back as 2–3 points from either
      // input. Refuse rather than ship a zero-area polygon — the AREA test above has already
      // said this ring is real, so emitting a line segment for it would be a lie, and
      // dropping it silently would contradict `droppedRings`, which means „below the area
      // floor" and must not come to mean two things.
      if (ring.length < 4) {
        throw new Error(
          `project_regions: ${key} has a ${area.toFixed(2)} px² ring that quantizes to ` +
            `${ring.length} point(s) — it is thinner than 0.05 px and cannot be drawn`,
        );
      }
      kept.push(ring);
      points += ring.length;
      const back = ring.map(([x, y]) => [x / 10, y / 10] as Pt);
      if (!largest || area > largest.area) largest = { area, ring: back };
    }
    if (!largest) {
      throw new Error(
        `project_regions: ${key} kept no ring above ${MIN_RING_AREA_PX2} px²`,
      );
    }
    const [cx, cy] = ringCentroid(largest.ring);
    regions[key] = {
      oblast,
      rings: kept,
      c: [Math.round(cx * 10), Math.round(cy * 10)],
    };
  }

  const anchors = oblastAnchorsLonLat();
  const cities: Record<string, FlyoverCity> = {};
  for (const code of OBLAST_CODES) {
    const rec = oblastRec(code);
    if (!rec) throw new Error(`project_regions: no census record for ${code}`);
    const [x, y] = project(anchors[code][0], anchors[code][1]);
    cities[code] = [
      Math.round(x * 10),
      Math.round(y * 10),
      rec.nameBg,
      rec.nameEn,
    ];
  }

  const geo: FlyoverGeo = {
    frame: { w: FRAME_W, h: FRAME_H },
    regions,
    cities,
  };
  return {
    geo,
    stats: {
      tolerance,
      sourcePoints,
      points,
      droppedRings,
      bytes: Buffer.byteLength(JSON.stringify(geo)),
    },
  };
};

/** Read the committed source and project it. */
export const projectCommittedRegions = (
  opts: ProjectOptions = {},
): { geo: FlyoverGeo; stats: ProjectStats } => {
  const fc: FeatureCollection = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/regions_map.json"), "utf8"),
  );
  return projectRegions(fc, opts);
};

export interface CliArgs {
  tolerance: number;
  out?: string;
}

/** Parse the CLI's two flags, refusing a flag with no value rather than defaulting silently. */
export const parseCliArgs = (argv: readonly string[]): CliArgs => {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    // Without this, `--tolerance` as the last argument runs at the default and reports
    // success, and a trailing `--out` writes nothing at exit 0: a mistyped invocation is
    // indistinguishable from a correct one.
    if (v === undefined || v.startsWith("--")) {
      throw new Error(`project_regions: --${name} needs a value`);
    }
    return v;
  };
  const raw = flag("tolerance");
  const tolerance = raw === undefined ? DEFAULT_TOLERANCE : Number(raw);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(
      `project_regions: --tolerance ${raw} is not a non-negative number`,
    );
  }
  const out = flag("out");
  return out === undefined ? { tolerance } : { tolerance, out };
};

const run = (): void => {
  const { tolerance, out } = parseCliArgs(process.argv.slice(2));
  const { geo, stats } = projectCommittedRegions({ tolerance });
  if (out) {
    const dest = path.isAbsolute(out) ? out : path.join(ROOT, out);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, JSON.stringify(geo, null, 2) + "\n");
  }
  console.log(
    `project_regions: ${Object.keys(geo.regions).length} \u041c\u0418\u0420 \u00b7 ` +
      `${Object.keys(geo.cities).length} oblast anchors \u00b7 tolerance ${stats.tolerance} px \u00b7 ` +
      `${stats.sourcePoints} \u2192 ${stats.points} points \u00b7 ` +
      `${stats.droppedRings} sliver ring(s) dropped \u00b7 ${stats.bytes} bytes` +
      (out ? ` \u00b7 wrote ${out}` : ""),
  );
};

// An exact match, not a substring: `…includes("geo/project_regions")` is also true of this
// module's own test file, so `npx tsx scripts/geo/project_regions.test.ts` would run the
// generator as a side effect.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run();
}
