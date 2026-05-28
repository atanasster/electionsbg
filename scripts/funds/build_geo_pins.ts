// Build slim per-municipio EU-funds project geo pins.
//
// Reads the heavy data/funds/projects/by-muni/<obshtina>.json (can be 20+ MB
// for Sofia) and emits a slim data/funds/projects/by-muni-geo/<obshtina>.json
// with one pin per contract that has a resolved location.ekatte. Joined
// against data/settlements.json for lat/lon.
//
// The SPA tile (MyAreaProjectsMapTile) reads only the slim file, so the
// "EU-funded projects in your área" Leaflet map loads on demand without
// pulling the full corpus.
//
// Run: `npx tsx scripts/funds/build_geo_pins.ts`
//
// Outputs are deterministic — re-running over unchanged source produces
// byte-identical output.

import fs from "node:fs";
import path from "node:path";

type SettlementInfo = {
  ekatte: string;
  name: string;
  obshtina: string;
  loc: string; // "lon,lat"
};

type FundsContract = {
  contractNumber: string;
  title: string;
  totalEur: number;
  paidEur: number;
  status: string;
  programName?: string;
  beneficiaryName?: string;
  location?: { kind?: string; ekatte?: string | null } | null;
};

type FundsMuniFile = {
  muni: string;
  contracts: FundsContract[];
};

export type GeoPin = {
  ekatte: string;
  lat: number;
  lon: number;
  title: string;
  totalEur: number;
  status: string;
  contractNumber: string;
  programName?: string;
};

export type GeoFile = {
  obshtina: string;
  generatedAt: string;
  // Source: the size of the per-municipio JSON we read this from. Lets the
  // SPA know there's a heavier source if a power-user wants the full list
  // (which we don't yet expose).
  sourceContractCount: number;
  geocodedCount: number;
  pins: GeoPin[];
};

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
);
const SETTLEMENTS_FILE = path.join(PROJECT_ROOT, "data/settlements.json");
const SRC_DIR = path.join(PROJECT_ROOT, "data/funds/projects/by-muni");
const OUT_DIR = path.join(PROJECT_ROOT, "data/funds/projects/by-muni-geo");

// Cap pins per município — the map only renders this many at a time anyway
// and Sofia would otherwise produce ~30k pins (un-clusterable in Leaflet
// without a clustering plugin). Top-N by totalEur preserves the
// most-significant projects.
const PINS_PER_MUNI_CAP = 200;

const parseLoc = (loc: string | undefined): [number, number] | null => {
  if (!loc) return null;
  const [lonStr, latStr] = loc.split(",");
  if (!lonStr || !latStr) return null;
  const lon = Number(lonStr);
  const lat = Number(latStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lat, lon];
};

const loadSettlements = (): Map<string, [number, number]> => {
  const raw = fs.readFileSync(SETTLEMENTS_FILE, "utf-8");
  const list = JSON.parse(raw) as SettlementInfo[];
  const m = new Map<string, [number, number]>();
  for (const s of list) {
    const ll = parseLoc(s.loc);
    if (ll) m.set(s.ekatte, ll);
  }
  return m;
};

const main = () => {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`source dir missing: ${SRC_DIR}`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ekatteToLatLon = loadSettlements();
  console.log(`Loaded ${ekatteToLatLon.size} settlement centroids`);

  const files = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".json") && !f.endsWith("-summary.json"));

  let totalIn = 0;
  let totalOut = 0;
  for (const f of files) {
    const fullPath = path.join(SRC_DIR, f);
    const raw = fs.readFileSync(fullPath, "utf-8");
    let bundle: FundsMuniFile;
    try {
      bundle = JSON.parse(raw);
    } catch {
      continue;
    }
    const obshtina = bundle.muni || path.basename(f, ".json");
    const contracts = bundle.contracts ?? [];
    totalIn += contracts.length;
    const pins: GeoPin[] = [];
    for (const c of contracts) {
      const ekatte = c.location?.ekatte;
      if (!ekatte) continue;
      const ll = ekatteToLatLon.get(ekatte);
      if (!ll) continue;
      pins.push({
        ekatte,
        lat: ll[0],
        lon: ll[1],
        title: c.title,
        totalEur: c.totalEur ?? 0,
        status: c.status,
        contractNumber: c.contractNumber,
        programName: c.programName,
      });
    }
    // Top-N by totalEur. Sort desc; the larger projects are the ones a user
    // is most likely to want to know about.
    pins.sort((a, b) => b.totalEur - a.totalEur);
    const trimmed = pins.slice(0, PINS_PER_MUNI_CAP);
    const out: GeoFile = {
      obshtina,
      generatedAt: new Date().toISOString(),
      sourceContractCount: contracts.length,
      geocodedCount: pins.length,
      pins: trimmed,
    };
    fs.writeFileSync(
      path.join(OUT_DIR, `${obshtina}.json`),
      JSON.stringify(out, null, 2) + "\n",
    );
    totalOut += trimmed.length;
  }
  console.log(
    `Wrote ${files.length} per-município geo files, ${totalIn} contracts in → ${totalOut} pins out (cap ${PINS_PER_MUNI_CAP}/município)`,
  );
};

main();
