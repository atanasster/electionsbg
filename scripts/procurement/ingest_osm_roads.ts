// One-off ingest of the Bulgarian national-road network geometry from
// OpenStreetMap, for the АПИ road dashboard hero map (/procurement/roads).
// Emits data/procurement/roads.json — a GeoJSON FeatureCollection of road
// LineStrings tagged with the corridor name + class, clipped to Bulgaria and
// decimated for a small country-scale payload.
//
// Coverage: motorways (A1..A6) always, plus republican roads (Път I/II) whose
// corridor is actually funded by an АПИ contract. OSM tags republican roads
// with bare numbers (ref="8", not "I-8"), so the class is derived from the
// highway type (trunk → I-class, primary → II-class) and the segment is only
// kept when the derived corridor (e.g. "I-1") matches a funded contract
// reference — which both bounds the payload and avoids drawing unfunded /
// mis-derived roads. Class III roads (highway=secondary/tertiary) are not
// fetched; their spend stays in the dashboard's tiles.
//
// Usage (network is only touched with --fetch; otherwise reads the cache):
//   npx tsx scripts/procurement/ingest_osm_roads.ts            # from cache
//   npx tsx scripts/procurement/ingest_osm_roads.ts --fetch    # re-pull OSM
// ODbL: data © OpenStreetMap contributors.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { roadRefOf } from "@/lib/roadAttributes";
import type { ProcurementContract } from "@/data/dataTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CACHE = path.join(ROOT, "data/_cache/osm/bg_major_roads.json");
const REGIONS_DIR = path.join(ROOT, "data/maps/regions");
const CONTRACTS = path.join(
  ROOT,
  "data/procurement/awarder_contracts/000695089.json",
);
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

// Derive the join corridor + class for an OSM way. Motorways use the A-ref;
// republican roads carry a bare number in OSM, so the class comes from the
// highway type (trunk → I, primary → II). Class-prefixed refs are honoured
// directly when present.
interface Derived {
  corridor: string;
  ref: string;
  roadClass: "АМ" | "I" | "II" | "III";
}
const deriveCorridor = (tags?: Record<string, string>): Derived | null => {
  const h = tags?.highway ?? "";
  const raw = (tags?.ref ?? "").replace(/\s+/g, "").toUpperCase();
  if (!raw) return null;
  const pref = /^(I{1,3})-(\d{1,5})$/.exec(raw);
  if (pref) {
    const cls = pref[1] as "I" | "II" | "III";
    return {
      corridor: `${cls}-${pref[2]}`,
      ref: `${cls}-${pref[2]}`,
      roadClass: cls,
    };
  }
  if ((h === "motorway" || h === "motorway_link") && /^A[1-6]$/.test(raw))
    return { corridor: CORRIDOR[raw] ?? raw, ref: raw, roadClass: "АМ" };
  if ((h === "trunk" || h === "trunk_link") && /^\d{1,3}$/.test(raw))
    return { corridor: `I-${raw}`, ref: `I-${raw}`, roadClass: "I" };
  if (h === "primary" && /^\d{1,4}$/.test(raw))
    return { corridor: `II-${raw}`, ref: `II-${raw}`, roadClass: "II" };
  return null;
};

// Corridors actually referenced by an АПИ contract — shares roadRefOf with the
// dashboard so the geometry filter and the FE join use identical keys.
const loadFundedCorridors = (): Set<string> => {
  const set = new Set<string>();
  try {
    const f = JSON.parse(fs.readFileSync(CONTRACTS, "utf8")) as {
      contracts?: ProcurementContract[];
    };
    for (const c of f.contracts ?? []) {
      const r = roadRefOf(c.title || "");
      if (r) set.add(r.corridor);
    }
  } catch {
    /* contracts shard missing — keep motorways only */
  }
  return set;
};

const main = () => {
  if (process.argv.includes("--fetch") || !fs.existsSync(CACHE))
    fetchOverpass();
  const raw = JSON.parse(fs.readFileSync(CACHE, "utf8")) as {
    elements: OsmWay[];
  };
  const rings = loadBgRings();
  const funded = loadFundedCorridors();
  console.log(`BG rings: ${rings.length}; funded corridors: ${funded.size}`);

  const features: unknown[] = [];
  const byCorridor: Record<string, number> = {};
  let dropped = 0;
  for (const w of raw.elements) {
    if (w.type !== "way" || !w.geometry || w.geometry.length < 2) continue;
    const d = deriveCorridor(w.tags);
    if (!d) continue;
    // Motorways are always shown (the hero); republican roads only when funded.
    if (d.roadClass !== "АМ" && !funded.has(d.corridor)) continue;
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
      properties: { ref: d.ref, corridor: d.corridor, class: d.roadClass },
      geometry: { type: "LineString", coordinates: pts },
    });
    byCorridor[d.corridor] = (byCorridor[d.corridor] ?? 0) + 1;
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
    `Wrote ${features.length} road segments (${kb} KB), dropped ${dropped} non-BG.`,
  );
  console.log("Distinct corridors:", Object.keys(byCorridor).length);
};

main();
