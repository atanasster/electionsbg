// One-off ingest of the Bulgarian motorway network geometry from OpenStreetMap,
// for the АПИ road dashboard hero map (/procurement/roads). Emits
// data/maps/roads.json — a GeoJSON FeatureCollection of motorway LineStrings
// tagged with the corridor name, clipped to Bulgaria and decimated for a small
// country-scale payload.
//
// Why motorways only: OSM tags BG republican roads with bare numbers (ref="8")
// not class-prefixed ("I-8"), so they cannot be joined to our contract road
// references precisely. Motorways carry an unambiguous ref (A1..A6) and the
// bulk of the corridor money (Струма, Хемус, Тракия, Марица). Republican-road
// spend stays covered in the dashboard's €/km and top-projects tiles.
//
// Usage (network is only touched with --fetch; otherwise reads the cache):
//   npx tsx scripts/procurement/ingest_osm_roads.ts            # from cache
//   npx tsx scripts/procurement/ingest_osm_roads.ts --fetch    # re-pull OSM
// ODbL: data © OpenStreetMap contributors.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CACHE = path.join(ROOT, "data/_cache/osm/bg_major_roads.json");
const REGIONS_DIR = path.join(ROOT, "data/maps/regions");
// Served via the public/procurement symlink (dev) + bucket:sync (prod), the
// same proven path as the awarder JSON. data/maps is not web-served.
const OUT = path.join(ROOT, "data/procurement/roads.json");

// A-ref → canonical corridor name (matches roadAttributes.ts MOTORWAYS).
const CORRIDOR: Record<string, string> = {
  A1: "Тракия",
  A2: "Хемус",
  A3: "Струма",
  A4: "Марица",
  A5: "Черно море",
  A6: "Европа",
};

const OVERPASS = "https://overpass-api.de/api/interpreter";
const QUERY =
  '[out:json][timeout:90];(way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary)$"]["ref"](41.0,22.0,44.4,29.0););out geom;';

interface OsmNode {
  lat: number;
  lon: number;
}
interface OsmWay {
  type: string;
  tags?: Record<string, string>;
  geometry?: OsmNode[];
}

const fetchOverpass = (): void => {
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  console.log("Fetching BG roads from Overpass…");
  execFileSync(
    "curl",
    [
      "-s",
      "-m",
      "150",
      OVERPASS,
      "-H",
      "User-Agent: naiasno-data-bg/1.0 (road network ingest)",
      "-H",
      "Accept: application/json",
      "--data-urlencode",
      `data=${QUERY}`,
      "-o",
      CACHE,
    ],
    { stdio: "inherit" },
  );
};

// --- Bulgaria boundary (point-in-polygon over the oblast polygons) ----------

interface Ring {
  pts: number[][]; // [lon, lat]
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// Generous Bulgaria envelope — used to reject stray non-BG geometry (the
// regions dir contains a world-map file, 32.json, whose rings would otherwise
// make every point test "inside").
const BG_ENV = { minX: 21.8, maxX: 29.0, minY: 40.8, maxY: 44.6 };

const loadBgRings = (): Ring[] => {
  const rings: Ring[] = [];
  const pushRing = (coords: number[][]) => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [x, y] of coords) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    // Reject rings that fall outside Bulgaria (e.g. the world-map 32.json).
    if (
      minX < BG_ENV.minX ||
      maxX > BG_ENV.maxX ||
      minY < BG_ENV.minY ||
      maxY > BG_ENV.maxY
    )
      return;
    rings.push({ pts: coords, minX, minY, maxX, maxY });
  };
  for (const f of fs.readdirSync(REGIONS_DIR)) {
    if (!f.endsWith(".json")) continue;
    const fc = JSON.parse(
      fs.readFileSync(path.join(REGIONS_DIR, f), "utf8"),
    ) as { features?: { geometry?: { type: string; coordinates: unknown } }[] };
    for (const feat of fc.features ?? []) {
      const g = feat.geometry;
      if (!g) continue;
      if (g.type === "Polygon") {
        pushRing((g.coordinates as number[][][])[0]);
      } else if (g.type === "MultiPolygon") {
        for (const poly of g.coordinates as number[][][][]) pushRing(poly[0]);
      }
    }
  }
  return rings;
};

const inRing = (x: number, y: number, r: Ring): boolean => {
  if (x < r.minX || x > r.maxX || y < r.minY || y > r.maxY) return false;
  let inside = false;
  const p = r.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const xi = p[i][0],
      yi = p[i][1],
      xj = p[j][0],
      yj = p[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
};
const inBg = (x: number, y: number, rings: Ring[]): boolean =>
  rings.some((r) => inRing(x, y, r));

// Distance-decimate a polyline: keep a point only if it is >eps from the last
// kept point. ~0.001° ≈ 100 m — plenty for a country-scale map.
const decimate = (pts: number[][], eps = 0.001): number[][] => {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [lx, ly] = out[out.length - 1];
    const [x, y] = pts[i];
    if (Math.abs(x - lx) > eps || Math.abs(y - ly) > eps)
      out.push([Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]);
  }
  out.push(pts[pts.length - 1].map((v) => Math.round(v * 1e4) / 1e4));
  return out;
};

const main = () => {
  if (process.argv.includes("--fetch") || !fs.existsSync(CACHE))
    fetchOverpass();
  const raw = JSON.parse(fs.readFileSync(CACHE, "utf8")) as {
    elements: OsmWay[];
  };
  const rings = loadBgRings();
  console.log(`BG boundary rings: ${rings.length}`);

  const features: unknown[] = [];
  const byCorridor: Record<string, number> = {};
  let dropped = 0;
  for (const w of raw.elements) {
    if (w.type !== "way" || !w.geometry || w.geometry.length < 2) continue;
    const h = w.tags?.highway ?? "";
    if (h !== "motorway" && h !== "motorway_link") continue;
    const ref = (w.tags?.ref ?? "").replace(/\s+/g, "").toUpperCase();
    if (!/^A[1-6]$/.test(ref)) continue;
    // BG clip — drop cross-border bleed (e.g. Romanian A2). Strict bbox gate
    // first (cheap, removes the obvious RO/RS/GR/TR overspill), then PIP.
    const mid = w.geometry[Math.floor(w.geometry.length / 2)];
    const inEnv =
      mid.lon >= 22.3 && mid.lon <= 28.7 && mid.lat >= 41.2 && mid.lat <= 44.25;
    if (!inEnv || !inBg(mid.lon, mid.lat, rings)) {
      dropped++;
      continue;
    }
    const pts = decimate(w.geometry.map((n) => [n.lon, n.lat]));
    features.push({
      type: "Feature",
      properties: { ref, corridor: CORRIDOR[ref] ?? ref },
      geometry: { type: "LineString", coordinates: pts },
    });
    byCorridor[CORRIDOR[ref] ?? ref] =
      (byCorridor[CORRIDOR[ref] ?? ref] ?? 0) + 1;
  }

  const fc = {
    type: "FeatureCollection",
    attribution: "© OpenStreetMap contributors (ODbL)",
    generatedAt: new Date().toISOString(),
    features,
  };
  fs.writeFileSync(OUT, JSON.stringify(fc));
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(
    `Wrote ${features.length} motorway segments (${kb} KB), dropped ${dropped} non-BG.`,
  );
  console.log("By corridor:", byCorridor);
};

main();
