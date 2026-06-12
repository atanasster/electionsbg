// Generate the район-breakdown data layer for the two общини с районно деление
// the pipeline does not split today (Plovdiv-city PDV22, Varna-city VAR06).
// Additive — derived entirely from already-generated per-section data, with NO
// change to generate_votes.ts and no full re-run. Two outputs:
//
//   data/maps/city_rayons/<muni>.json        район polygons (geometry, once)
//   data/<election>/rayon/<muni>.json         район results (per election)
//
// район MEMBERSHIP and vote results come straight from ЦИК's section code, NOT
// from geography: the 9-digit "Пълен код на секция" = МИР(2) + община(2) +
// админ. район(2) + секция(3), so digits 5-6 (id.slice(4, 6)) ARE the админ.
// район. код -> name (NAMES below) uses the official names from the Закон за
// териториалното деление на Столичната община и големите градове, verified
// against per-код section-coordinate centroids (all 6 PDV + 5 VAR consistent).
// Only the район POLYGONS are an approximation: there is no official район GIS,
// so we Voronoi over deduped section coords, dissolve per район, and clip to the
// city outline — good enough for map shading, but not a cadastre.
// Mobile/ship sections (район code 00) are summed into a separate `_mobile`
// entry with no polygon so no voter is dropped.
//
// Derived from parliamentary section data, so it runs as part of the main
// pipeline (the `--city-rayons` step, folded into `--all`/`npm run prod`) —
// never a manual one-off that can lag behind a re-ingest. Standalone:
// `npm run data -- --city-rayons` (or `npx tsx scripts/helpers/gen_city_rayon_data.ts`).
// Output is gitignored + bucket-served: publish with `npm run bucket:sync:all`.

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
  const ring = mp.reduce(
    (big, p) => (p[0].length > big.length ? p[0] : big),
    mp[0][0],
  );
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

type SecVote = {
  partyNum: number;
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
  suemgVotes?: number;
};
type Sec = {
  section: string;
  longitude?: number;
  latitude?: number;
  results: {
    votes: SecVote[];
    // The full СИК protocol — kept as a numeric bag so the município-shard
    // builder can sum every field a real /municipalities/<obshtina>.json
    // carries (registered voters, invalid ballots, machine tallies, …).
    protocol?: Record<string, number | undefined>;
  };
};

function cityOutline(nuts3: string, muni: string): Ring[] {
  const map = JSON.parse(
    fs.readFileSync(`data/maps/regions/${nuts3}.json`, "utf8"),
  );
  return map.features.find(
    (f: { properties: { nuts4: string } }) => f.properties.nuts4 === muni,
  ).geometry.coordinates as Ring[];
}

// ---- geometry (built once, from the most recent election with coords) -------
function buildGeometry(muni: keyof typeof CITIES, election: string) {
  const cfg = CITIES[muni];
  const sec = JSON.parse(
    fs.readFileSync(
      `data/${election}/sections/by-oblast/${cfg.mir}.json`,
      "utf8",
    ),
  ) as Record<string, Sec>;
  const byKey = new Map<
    string,
    { lon: number; lat: number; votes: Record<string, number> }
  >();
  for (const s of Object.values(sec)) {
    const id = String(s.section);
    if (id.slice(2, 4) !== cfg.muni) continue;
    const rayon = id.slice(4, 6);
    if (rayon === "00") continue;
    if (
      !(
        Number.isFinite(s.longitude) &&
        Number.isFinite(s.latitude) &&
        s.latitude
      )
    )
      continue;
    const key = `${s.longitude!.toFixed(5)},${s.latitude!.toFixed(5)}`;
    const e = byKey.get(key) ?? {
      lon: s.longitude!,
      lat: s.latitude!,
      votes: {},
    };
    e.votes[rayon] = (e.votes[rayon] ?? 0) + 1;
    byKey.set(key, e);
  }
  const points = [...byKey.values()].map((e) => ({
    lon: e.lon,
    lat: e.lat,
    rayon: Object.entries(e.votes).sort((a, b) => b[1] - a[1])[0][0],
  }));
  const city = cityOutline(cfg.nuts3, muni);
  const cl = city[0].map((c) => c[0]),
    ct = city[0].map((c) => c[1]);
  const px = (Math.max(...cl) - Math.min(...cl)) * 0.1,
    py = (Math.max(...ct) - Math.min(...ct)) * 0.1;
  const vor = Delaunay.from(
    points,
    (p) => p.lon,
    (p) => p.lat,
  ).voronoi([
    Math.min(...cl) - px,
    Math.min(...ct) - py,
    Math.max(...cl) + px,
    Math.max(...ct) + py,
  ]);
  const codes = [...new Set(points.map((p) => p.rayon))].sort();
  const features = codes.map((c) => {
    const cells: Ring[][] = [];
    points.forEach((p, i) => {
      if (p.rayon !== c) return;
      const cell = vor.cellPolygon(i);
      if (cell) cells.push([cell as Ring]);
    });
    const dissolved = polygonClipping.union(
      cells[0] as never,
      ...(cells.slice(1) as never[]),
    );
    const clipped = rewind(
      polygonClipping.intersection(
        dissolved as never,
        city as never,
      ) as number[][][][],
    );
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
  fs.writeFileSync(
    `data/maps/city_rayons/${muni}.json`,
    JSON.stringify({ type: "FeatureCollection", features }),
  );
  return codes;
}

// ---- per-election район results --------------------------------------------
function buildResults(muni: keyof typeof CITIES, election: string) {
  const cfg = CITIES[muni];
  const f = `data/${election}/sections/by-oblast/${cfg.mir}.json`;
  if (!fs.existsSync(f)) return 0;
  const sec = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, Sec>;
  const agg = new Map<
    string,
    {
      votes: Map<
        number,
        { totalVotes: number; paperVotes: number; machineVotes: number }
      >;
      voters: number;
      valid: number;
    }
  >();
  for (const s of Object.values(sec)) {
    const id = String(s.section);
    if (id.slice(2, 4) !== cfg.muni) continue;
    const rayon = id.slice(4, 6); // "00" -> _mobile bucket
    const key = rayon === "00" ? "_mobile" : rayon;
    const e = agg.get(key) ?? { votes: new Map(), voters: 0, valid: 0 };
    for (const v of s.results.votes) {
      const cur = e.votes.get(v.partyNum) ?? {
        totalVotes: 0,
        paperVotes: 0,
        machineVotes: 0,
      };
      cur.totalVotes += v.totalVotes;
      cur.paperVotes += v.paperVotes ?? 0;
      cur.machineVotes += v.machineVotes ?? 0;
      e.votes.set(v.partyNum, cur);
    }
    e.voters += s.results.protocol?.totalActualVoters ?? 0;
    e.valid +=
      (s.results.protocol?.numValidVotes ?? 0) +
      (s.results.protocol?.numValidMachineVotes ?? 0);
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
        votes: [...e.votes.entries()].map(([partyNum, v]) => ({
          partyNum,
          ...v,
        })),
        protocol: { totalActualVoters: e.voters, numValidVotes: e.valid },
      },
    }));
  const mobile = agg.get("_mobile");
  const out = {
    municipality: muni,
    rayons: rows,
    mobile: mobile
      ? {
          voters: mobile.voters,
          votes: [...mobile.votes.entries()].map(([partyNum, v]) => ({
            partyNum,
            ...v,
          })),
        }
      : undefined,
  };
  fs.mkdirSync(`data/${election}/rayon`, { recursive: true });
  fs.writeFileSync(`data/${election}/rayon/${muni}.json`, JSON.stringify(out));
  return rows.length;
}

// ---- per-район município-shaped shards -------------------------------------
// Emits one /<election>/municipalities/<muni>-<code>.json per район, shaped
// exactly like a real município artifact ({key, obshtina, oblast, results:
// {votes[], protocol}}), so /settlement/<muni>-<code> can drive the standard
// MunicipalityDashboardCards (party results, turnout, paper/machine, SUEMG
// flash-memory, recount). These shards are NOT added to municipalities.json,
// so national rollups (which iterate that index) never double-count them.
function buildMunicipalityShards(muni: keyof typeof CITIES, election: string) {
  const cfg = CITIES[muni];
  const f = `data/${election}/sections/by-oblast/${cfg.mir}.json`;
  if (!fs.existsSync(f)) return 0;
  const sec = JSON.parse(fs.readFileSync(f, "utf8")) as Record<string, Sec>;
  const agg = new Map<
    string,
    { votes: Map<number, SecVote>; protocol: Record<string, number> }
  >();
  for (const s of Object.values(sec)) {
    const id = String(s.section);
    if (id.slice(2, 4) !== cfg.muni) continue;
    const code = id.slice(4, 6);
    if (code === "00" || !NAMES[muni][code]) continue; // skip mobile/ship
    const e = agg.get(code) ?? {
      votes: new Map<number, SecVote>(),
      protocol: {} as Record<string, number>,
    };
    for (const v of s.results.votes) {
      const cur = e.votes.get(v.partyNum) ?? {
        partyNum: v.partyNum,
        totalVotes: 0,
        paperVotes: 0,
        machineVotes: 0,
        suemgVotes: 0,
      };
      cur.totalVotes += v.totalVotes;
      cur.paperVotes = (cur.paperVotes ?? 0) + (v.paperVotes ?? 0);
      cur.machineVotes = (cur.machineVotes ?? 0) + (v.machineVotes ?? 0);
      cur.suemgVotes = (cur.suemgVotes ?? 0) + (v.suemgVotes ?? 0);
      e.votes.set(v.partyNum, cur);
    }
    // Sum every numeric protocol field so the shard carries the full picture.
    for (const [k, val] of Object.entries(s.results.protocol ?? {})) {
      if (typeof val === "number") e.protocol[k] = (e.protocol[k] ?? 0) + val;
    }
    agg.set(code, e);
  }
  let n = 0;
  fs.mkdirSync(`data/${election}/municipalities`, { recursive: true });
  for (const [code, e] of agg) {
    const out = {
      key: `${muni}-${code}`,
      obshtina: `${muni}-${code}`,
      oblast: cfg.nuts3,
      results: {
        votes: [...e.votes.values()].sort(
          (a, b) => b.totalVotes - a.totalVotes,
        ),
        protocol: e.protocol,
      },
    };
    fs.writeFileSync(
      `data/${election}/municipalities/${muni}-${code}.json`,
      JSON.stringify(out),
    );
    n++;
  }
  return n;
}

// Rebuild every район artifact (geometry + per-election results + município
// shards) from the current parliamentary section data. Folded into the main
// pipeline (`npm run data -- --city-rayons`, and `--all`/`npm run prod`) so it
// can't go stale after a parliamentary re-ingest; also runnable standalone.
export function generateCityRayonData() {
  const elections = fs
    .readdirSync("data")
    .filter((d) => /^\d{4}_\d{2}_\d{2}$/.test(d))
    .filter((d) => fs.existsSync(`data/${d}/sections/by-oblast`));
  const newest = elections[elections.length - 1];
  for (const muni of Object.keys(CITIES) as (keyof typeof CITIES)[]) {
    const codes = buildGeometry(muni, newest);
    let nEl = 0;
    let nShards = 0;
    for (const el of elections) {
      if (buildResults(muni, el)) nEl++;
      nShards += buildMunicipalityShards(muni, el);
    }
    console.log(
      `${muni}: geometry ${codes.length} районы (from ${newest}); results for ${nEl}/${elections.length} elections; ${nShards} município shards`,
    );
  }
}

// Direct-run entry: `npx tsx scripts/helpers/gen_city_rayon_data.ts`.
if (process.argv[1] && process.argv[1].endsWith("gen_city_rayon_data.ts")) {
  generateCityRayonData();
}
