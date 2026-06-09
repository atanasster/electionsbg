// Generate the район-breakdown data layer for the two общини с районно деление
// the pipeline does not split today (Plovdiv-city PDV22, Varna-city VAR06).
// Additive — derived entirely from already-generated per-section data, with NO
// change to generate_votes.ts and no full re-run. Two outputs:
//
//   data/maps/city_rayons/<muni>.json        район polygons (geometry, once)
//   data/<election>/rayon/<muni>.json         район results (per election)
//
// район geometry = Voronoi over deduped section coords, dissolved per район,
// clipped to the city outline. район code -> name is OSM-hall-verified.
// Mobile/ship sections (район code 00) are summed into a separate `_mobile`
// entry with no polygon so no voter is dropped.
//
// Run: npx tsx scripts/helpers/gen_city_rayon_data.ts

import fs from "fs";
import { Delaunay } from "d3-delaunay";
import { geoArea } from "d3-geo";
import polygonClipping from "polygon-clipping";

// polygon-clipping emits rings in a winding d3-geo reads inverted, so the
// spherical area comes out as (4π − tiny) ≈ the whole globe minus the район.
// d3.geoPath/geoBounds then treat the район as the OUTSIDE of the sphere (giant
// fill, global map bounds). Detect that (area > half the sphere) and reverse
// every ring so the район is the small interior again.
const rewind = (mp: number[][][][]): number[][][][] => {
  const area = geoArea({ type: "MultiPolygon", coordinates: mp } as never);
  if (area <= 2 * Math.PI) return mp;
  return mp.map((poly) => poly.map((ring) => [...ring].reverse()));
};

// Planar centroid of the largest polygon's outer ring. We avoid d3.geoCentroid
// because polygon-clipping's ring winding makes the spherical centroid flip to
// the antipode; a planar mean is exact enough for marker placement at city
// scale.
const ringCentroid = (mp: number[][][][]): [number, number] => {
  const ring = mp.reduce((big, p) => (p[0].length > big.length ? p[0] : big), mp[0][0]);
  const n = ring.length;
  const sum = ring.reduce((a, [lo, la]) => [a[0] + lo, a[1] + la], [0, 0]);
  return [sum[0] / n, sum[1] / n];
};

type Ring = [number, number][];

const NAMES: Record<string, Record<string, { bg: string; en: string }>> = {
  PDV22: {
    "01": { bg: "Централен", en: "Tsentralen" },
    "02": { bg: "Източен", en: "Iztochen" },
    "03": { bg: "Западен", en: "Zapaden" },
    "04": { bg: "Северен", en: "Severen" },
    "05": { bg: "Южен", en: "Yuzhen" },
    "06": { bg: "Тракия", en: "Trakiya" },
  },
  VAR06: {
    "01": { bg: "Одесос", en: "Odesos" },
    "02": { bg: "Приморски", en: "Primorski" },
    "03": { bg: "Младост", en: "Mladost" },
    "04": { bg: "Владислав Варненчик", en: "Vladislav Varnenchik" },
    "05": { bg: "Аспарухово", en: "Asparuhovo" },
  },
};

const CITIES = {
  PDV22: { mir: "16", muni: "22", nuts3: "PDV-00" },
  VAR06: { mir: "03", muni: "06", nuts3: "VAR" },
};

type Sec = {
  section: string;
  longitude?: number;
  latitude?: number;
  results: { votes: { partyNum: number; totalVotes: number; paperVotes?: number; machineVotes?: number }[]; protocol?: { totalActualVoters?: number; numValidVotes?: number; numValidMachineVotes?: number } };
};

const elections = fs
  .readdirSync("data")
  .filter((d) => /^\d{4}_\d{2}_\d{2}$/.test(d))
  .filter((d) => fs.existsSync(`data/${d}/sections/by-oblast`));

function cityOutline(nuts3: string, muni: string): Ring[] {
  const map = JSON.parse(fs.readFileSync(`data/maps/regions/${nuts3}.json`, "utf8"));
  return map.features.find((f: { properties: { nuts4: string } }) => f.properties.nuts4 === muni).geometry
    .coordinates as Ring[];
}

// ---- geometry (built once, from the most recent election with coords) -------
function buildGeometry(muni: keyof typeof CITIES, election: string) {
  const cfg = CITIES[muni];
  const sec = JSON.parse(fs.readFileSync(`data/${election}/sections/by-oblast/${cfg.mir}.json`, "utf8")) as Record<string, Sec>;
  const byKey = new Map<string, { lon: number; lat: number; votes: Record<string, number> }>();
  for (const s of Object.values(sec)) {
    const id = String(s.section);
    if (id.slice(2, 4) !== cfg.muni) continue;
    const rayon = id.slice(4, 6);
    if (rayon === "00") continue;
    if (!(Number.isFinite(s.longitude) && Number.isFinite(s.latitude) && s.latitude)) continue;
    const key = `${s.longitude!.toFixed(5)},${s.latitude!.toFixed(5)}`;
    const e = byKey.get(key) ?? { lon: s.longitude!, lat: s.latitude!, votes: {} };
    e.votes[rayon] = (e.votes[rayon] ?? 0) + 1;
    byKey.set(key, e);
  }
  const points = [...byKey.values()].map((e) => ({
    lon: e.lon,
    lat: e.lat,
    rayon: Object.entries(e.votes).sort((a, b) => b[1] - a[1])[0][0],
  }));
  const city = cityOutline(cfg.nuts3, muni);
  const cl = city[0].map((c) => c[0]), ct = city[0].map((c) => c[1]);
  const px = (Math.max(...cl) - Math.min(...cl)) * 0.1, py = (Math.max(...ct) - Math.min(...ct)) * 0.1;
  const vor = Delaunay.from(points, (p) => p.lon, (p) => p.lat).voronoi([
    Math.min(...cl) - px, Math.min(...ct) - py, Math.max(...cl) + px, Math.max(...ct) + py,
  ]);
  const codes = [...new Set(points.map((p) => p.rayon))].sort();
  const features = codes.map((c) => {
    const cells: Ring[][] = [];
    points.forEach((p, i) => {
      if (p.rayon !== c) return;
      const cell = vor.cellPolygon(i);
      if (cell) cells.push([cell as Ring]);
    });
    const dissolved = polygonClipping.union(cells[0] as never, ...(cells.slice(1) as never[]));
    const clipped = rewind(polygonClipping.intersection(dissolved as never, city as never) as number[][][][]);
    const geometry = { type: "MultiPolygon" as const, coordinates: clipped };
    // Centroid -> "lon,lat" so the map's MapMarker (vote-sized dot) can place
    // itself, same as a municipality's `loc`.
    const [clon, clat] = ringCentroid(clipped as number[][][][]);
    return {
      type: "Feature",
      properties: {
        nuts4: `${muni}-${c}`,
        nuts3: cfg.nuts3,
        rayon: c,
        name: NAMES[muni][c].bg,
        name_en: NAMES[muni][c].en,
        loc: `${clon.toFixed(5)},${clat.toFixed(5)}`,
      },
      geometry,
    };
  });
  fs.mkdirSync("data/maps/city_rayons", { recursive: true });
  fs.writeFileSync(`data/maps/city_rayons/${muni}.json`, JSON.stringify({ type: "FeatureCollection", features }));
  return codes;
}

// ---- per-election район results --------------------------------------------
function buildResults(muni: keyof typeof CITIES, election: string) {
  const cfg = CITIES[muni];
  const f = `data/${election}/sections/by-oblast/${cfg.mir}.json`;
  if (!fs.existsSync(f)) return 0;
  const sec = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, Sec>;
  const agg = new Map<string, { votes: Map<number, { totalVotes: number; paperVotes: number; machineVotes: number }>; voters: number; valid: number }>();
  for (const s of Object.values(sec)) {
    const id = String(s.section);
    if (id.slice(2, 4) !== cfg.muni) continue;
    const rayon = id.slice(4, 6); // "00" -> _mobile bucket
    const key = rayon === "00" ? "_mobile" : rayon;
    const e = agg.get(key) ?? { votes: new Map(), voters: 0, valid: 0 };
    for (const v of s.results.votes) {
      const cur = e.votes.get(v.partyNum) ?? { totalVotes: 0, paperVotes: 0, machineVotes: 0 };
      cur.totalVotes += v.totalVotes;
      cur.paperVotes += v.paperVotes ?? 0;
      cur.machineVotes += v.machineVotes ?? 0;
      e.votes.set(v.partyNum, cur);
    }
    e.voters += s.results.protocol?.totalActualVoters ?? 0;
    e.valid += (s.results.protocol?.numValidVotes ?? 0) + (s.results.protocol?.numValidMachineVotes ?? 0);
    agg.set(key, e);
  }
  if (!agg.size) return 0;
  const rows = [...agg.entries()]
    .filter(([k]) => k !== "_mobile" && NAMES[muni][k])
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, e]) => ({
      key: code,
      obshtina: `${muni}-${code}`,
      oblast: cfg.nuts3,
      name: NAMES[muni][code].bg,
      name_en: NAMES[muni][code].en,
      results: {
        votes: [...e.votes.entries()].map(([partyNum, v]) => ({ partyNum, ...v })),
        protocol: { totalActualVoters: e.voters, numValidVotes: e.valid },
      },
    }));
  const mobile = agg.get("_mobile");
  const out = {
    municipality: muni,
    rayons: rows,
    mobile: mobile
      ? { voters: mobile.voters, votes: [...mobile.votes.entries()].map(([partyNum, v]) => ({ partyNum, ...v })) }
      : undefined,
  };
  fs.mkdirSync(`data/${election}/rayon`, { recursive: true });
  fs.writeFileSync(`data/${election}/rayon/${muni}.json`, JSON.stringify(out));
  return rows.length;
}

const newest = elections[elections.length - 1];
for (const muni of Object.keys(CITIES) as (keyof typeof CITIES)[]) {
  const codes = buildGeometry(muni, newest);
  let nEl = 0;
  for (const el of elections) if (buildResults(muni, el)) nEl++;
  console.log(`${muni}: geometry ${codes.length} районы (from ${newest}); results for ${nEl}/${elections.length} elections`);
}
