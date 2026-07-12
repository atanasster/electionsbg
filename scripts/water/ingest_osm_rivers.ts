// One-off ingest of Bulgaria's major-river geometry from OpenStreetMap, for the
// /water flood-maintenance choropleth's decorative "river spine" (docs/plans/
// water-view-v1.md §4.5b). Emits data/water/rivers.json — a GeoJSON
// FeatureCollection of river LineStrings tagged with the river name, clipped to
// Bulgaria and decimated for a small country-scale payload.
//
// The spine is context only (it is NOT coloured by spend): the riverbed-cleaning
// money is fragmented across ~100 small local watercourses, so the map's data
// layer is the per-oblast choropleth; the big rivers just make it read as water.
// Only a curated allowlist of major rivers is fetched, so the payload stays tiny.
//
// Usage (network is only touched with --fetch; otherwise reads the cache):
//   npx tsx scripts/water/ingest_osm_rivers.ts            # from cache
//   npx tsx scripts/water/ingest_osm_rivers.ts --fetch    # re-pull OSM
// ODbL: data © OpenStreetMap contributors.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CACHE = path.join(ROOT, "data/_cache/osm/bg_major_rivers.json");
const REGIONS_DIR = path.join(ROOT, "data/maps/regions");
// Served by the vite data middleware (dev) + bucket:sync (prod), same as the
// other data/water artifacts.
const OUT = path.join(ROOT, "data/water/rivers.json");

// Major named rivers (OSM Cyrillic name=). Keeps the spine legible + the payload
// small; smaller local rivers named in individual contracts are intentionally
// omitted (they carry a minority of spend and clutter the country view).
const RIVERS = [
  "Дунав",
  "Марица",
  "Искър",
  "Струма",
  "Тунджа",
  "Янтра",
  "Места",
  "Осъм",
  "Вит",
  "Арда",
  "Камчия",
  "Огоста",
  "Росица",
  "Русенски Лом",
  "Бели Лом",
  "Тополница",
  "Съзлийка",
];

const OVERPASS = "https://overpass-api.de/api/interpreter";
const QUERY = `[out:json][timeout:120];(way["waterway"="river"]["name"~"^(${RIVERS.join("|")})$"](40.8,22.0,44.6,29.0););out geom;`;

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
  console.log("Fetching BG major rivers from Overpass…");
  execFileSync(
    "curl",
    [
      "-s",
      "-m",
      "150",
      OVERPASS,
      "-H",
      "User-Agent: naiasno-data-bg/1.0 (river network ingest)",
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
  pts: number[][];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
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
      if (g.type === "Polygon") pushRing((g.coordinates as number[][][])[0]);
      else if (g.type === "MultiPolygon")
        for (const poly of g.coordinates as number[][][][]) pushRing(poly[0]);
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

// Keep a way if any of a few sample points is inside BG — border rivers (Danube
// centre-line is the frontier) would fail a single midpoint test.
const touchesBg = (pts: number[][], rings: Ring[]): boolean => {
  const n = pts.length;
  for (const p of [pts[0], pts[Math.floor(n / 2)], pts[n - 1]])
    if (
      p[0] >= BG_ENV.minX &&
      p[0] <= BG_ENV.maxX &&
      p[1] >= BG_ENV.minY &&
      p[1] <= BG_ENV.maxY &&
      inBg(p[0], p[1], rings)
    )
      return true;
  return false;
};

// Rivers are decorative → decimate hard (~0.004° ≈ 400 m).
const decimate = (pts: number[][], eps = 0.004): number[][] => {
  if (pts.length <= 2)
    return pts.map((p) => p.map((v) => Math.round(v * 1e4) / 1e4));
  const out = [pts[0].map((v) => Math.round(v * 1e4) / 1e4)];
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
  console.log(`BG rings: ${rings.length}`);

  const features: unknown[] = [];
  const byName: Record<string, number> = {};
  let dropped = 0;
  for (const w of raw.elements) {
    if (w.type !== "way" || !w.geometry || w.geometry.length < 2) continue;
    const name = w.tags?.name ?? "";
    if (!RIVERS.includes(name)) continue;
    const pts = w.geometry.map((n) => [n.lon, n.lat]);
    if (!touchesBg(pts, rings)) {
      dropped++;
      continue;
    }
    features.push({
      type: "Feature",
      properties: { name },
      geometry: { type: "LineString", coordinates: decimate(pts) },
    });
    byName[name] = (byName[name] ?? 0) + 1;
  }

  const fc = {
    type: "FeatureCollection",
    attribution: "© OpenStreetMap contributors (ODbL)",
    features,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(fc));
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(
    `Wrote ${features.length} river segments (${kb} KB), dropped ${dropped} non-BG.`,
  );
  console.log(
    "Rivers:",
    Object.entries(byName)
      .map(([n, c]) => `${n}(${c})`)
      .join(", "),
  );
};

main();
