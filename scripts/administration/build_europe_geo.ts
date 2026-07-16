// Europe country geometry for the reusable EU choropleth (EuChoroplethMap).
// Sourced from Eurostat GISCO (CNTR_RG_60M) — whose CNTR_ID already uses the
// Eurostat geo codes (EL for Greece, UK for the United Kingdom), so it joins
// directly to isoc_*/macro Eurostat payloads keyed by geo. We keep only the
// European frame, drop every property except `geo`, round coordinates to ~1 km
// and Douglas-Peucker-simplify (it's a small on-page map, not a zoomable one),
// then normalise ring winding for d3's spherical renderer. Bucket-served like
// every other map — no JS-bundle weight.
//
//   npx tsx scripts/administration/build_europe_geo.ts
//
// Re-run only if the borders change (essentially never) — the asset is committed.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as d3 from "d3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const OUT = path.resolve(REPO_ROOT, "data/maps/europe/countries.json");

const SRC =
  "https://gisco-services.ec.europa.eu/distribution/v2/countries/geojson/CNTR_RG_60M_2024_4326.geojson";

// The European frame: EU27 + EFTA + (potential) candidates + a few neighbours
// for context (they render grey when a payload has no value for them). Codes are
// GISCO CNTR_ID == Eurostat geo.
const EUROPE = new Set([
  // EU27
  "BE",
  "BG",
  "CZ",
  "DK",
  "DE",
  "EE",
  "IE",
  "EL",
  "ES",
  "FR",
  "HR",
  "IT",
  "CY",
  "LV",
  "LT",
  "LU",
  "HU",
  "MT",
  "NL",
  "AT",
  "PL",
  "PT",
  "RO",
  "SI",
  "SK",
  "FI",
  "SE",
  // EFTA
  "IS",
  "LI",
  "NO",
  "CH",
  // candidates / potential candidates
  "AL",
  "BA",
  "ME",
  "MK",
  "RS",
  "TR",
  "XK",
  "UA",
  "MD",
  // context neighbours
  "GB",
  "BY",
]);

const round = (n: number) => Math.round(n * 100) / 100; // ~1.1 km

// Continental-Europe window. Rings entirely outside it (French Guiana, Réunion,
// the Azores, the Canaries, …) are dropped — otherwise those overseas polygons
// blow up the map's projection fit (Europe compresses to a dot). Keeps Iceland
// (−25°), Cyprus/Turkey (45°E) and the far north (Svalbard is a separate ring
// that falls outside).
const WIN = { lonMin: -25, lonMax: 45, latMin: 34, latMax: 72 };
const ringInWindow = (ring: number[][]): boolean => {
  let minx = 180,
    maxx = -180,
    miny = 90,
    maxy = -90;
  for (const [x, y] of ring) {
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
  }
  // bbox intersects the European window?
  return (
    maxx >= WIN.lonMin &&
    minx <= WIN.lonMax &&
    maxy >= WIN.latMin &&
    miny <= WIN.latMax
  );
};

type Ring = number[][];

// Douglas-Peucker simplification. At ≤640px spanning ~45° of longitude one pixel
// is ~0.07°, so a 0.03° tolerance drops near-collinear vertices invisibly.
const TOL = 0.03;
const segDist = (p: number[], a: number[], b: number[]): number => {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return Math.sqrt(dx * dx + dy * dy);
};
const simplifyRing = (ring: Ring): Ring => {
  if (ring.length <= 4) return ring;
  const keep = new Array(ring.length).fill(false);
  keep[0] = keep[ring.length - 1] = true;
  const stack: Array<[number, number]> = [[0, ring.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop() as [number, number];
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(ring[i], ring[s], ring[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > TOL && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring; // keep small rings intact
};
const simplifyGeom = (g: {
  type: string;
  coordinates: unknown;
}): { type: string; coordinates: unknown } => {
  if (g.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: (g.coordinates as Ring[]).map(simplifyRing),
    };
  }
  if (g.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: (g.coordinates as Ring[][]).map((p) => p.map(simplifyRing)),
    };
  }
  return g;
};

const roundGeom = (g: {
  type: string;
  coordinates: unknown;
}): { type: string; coordinates: unknown } => {
  const rr = (coords: unknown): unknown => {
    if (
      Array.isArray(coords) &&
      coords.length === 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      return [round(coords[0]), round(coords[1])];
    }
    return (coords as unknown[]).map(rr);
  };
  return { type: g.type, coordinates: rr(g.coordinates) };
};

// Drop degenerate rings that collapse after rounding (tiny islands), so the
// path data stays clean.
const dropEmpty = (g: {
  type: string;
  coordinates: unknown;
}): { type: string; coordinates: unknown } | null => {
  if (g.type === "Polygon") {
    const rings = (g.coordinates as Ring[]).filter((r) => r.length >= 4);
    // Drop the whole polygon if its outer ring is outside Europe.
    if (!rings.length || !ringInWindow(rings[0])) return null;
    return { type: "Polygon", coordinates: rings };
  }
  if (g.type === "MultiPolygon") {
    const polys = (g.coordinates as Ring[][])
      .map((p) => p.filter((r) => r.length >= 4))
      // Keep only sub-polygons whose outer ring is inside Europe.
      .filter((p) => p.length && ringInWindow(p[0]));
    return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
  }
  return g;
};

// Normalise ring winding for d3-geo's SPHERICAL renderer: if a polygon's outer
// ring covers more than half the sphere (geoArea > 2π), it is wound the wrong
// way and d3 would render it as the whole-globe complement (the polygon fills
// the map / projects to infinity). Reverse every ring in that polygon. Coordinate
// rounding can flip a marginal ring's winding, so this runs after rounding.
const TWO_PI = 2 * Math.PI;
const fixPoly = (rings: Ring[]): Ring[] => {
  const area = d3.geoArea({ type: "Polygon", coordinates: [rings[0]] });
  return area > TWO_PI ? rings.map((r) => r.slice().reverse()) : rings;
};
const fixWinding = (g: {
  type: string;
  coordinates: unknown;
}): { type: string; coordinates: unknown } => {
  if (g.type === "Polygon") {
    return { type: "Polygon", coordinates: fixPoly(g.coordinates as Ring[]) };
  }
  if (g.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: (g.coordinates as Ring[][]).map(fixPoly),
    };
  }
  return g;
};

const run = async (): Promise<void> => {
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching GISCO`);
  const fc = (await res.json()) as {
    features: Array<{
      properties: { CNTR_ID: string };
      geometry: { type: string; coordinates: unknown };
    }>;
  };

  const features = fc.features
    .filter((f) => EUROPE.has(f.properties.CNTR_ID))
    .map((f) => {
      const geom = dropEmpty(simplifyGeom(roundGeom(f.geometry)));
      return geom
        ? {
            type: "Feature" as const,
            properties: { geo: f.properties.CNTR_ID },
            geometry: fixWinding(geom),
          }
        : null;
    })
    .filter((f): f is NonNullable<typeof f> => f != null)
    .sort((a, b) => a.properties.geo.localeCompare(b.properties.geo));

  const out = { type: "FeatureCollection" as const, features };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log(
    `✓ wrote ${path.relative(REPO_ROOT, OUT)} — ${features.length} countries, ${kb} KB`,
  );
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
