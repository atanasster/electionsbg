// Build slim per-municipio EU-funds project list + geo pins.
//
// Reads the heavy data/funds/projects/by-muni/<obshtina>.json (can be 20+ MB
// for Sofia) and emits a slim data/funds/projects/by-muni-geo/<obshtina>.json
// with the top-N contracts by money — geocoded and non-geocoded together.
// Each contract that resolves to a location.ekatte carries lat/lon (joined
// against data/settlements.json); the rest carry none.
//
// The SPA tile (MyAreaProjectsMapTile) reads only this slim file: it renders
// the full list from `contracts` and the on-demand Leaflet map from the
// subset that carries lat/lon — so neither the list nor the map needs the
// full corpus.
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

export type GeoContract = {
  contractNumber: string;
  title: string;
  totalEur: number;
  status: string;
  programName?: string;
  // Present only when the contract resolved to a settlement centroid —
  // these are the ones the map can pin.
  ekatte?: string;
  lat?: number;
  lon?: number;
};

export type GeoFile = {
  obshtina: string;
  generatedAt: string;
  // Total contracts in the per-municipio corpus. `contracts` below is
  // capped, so this is the honest headline count for the tile.
  sourceContractCount: number;
  // How many of the município's contracts resolved to a location (and so
  // can become a map pin). May exceed contracts.length when the cap bites.
  geocodedCount: number;
  // Top-N contracts by money — geocoded and non-geocoded together. The list
  // renders all of these; the map renders the subset carrying lat/lon.
  contracts: GeoContract[];
};

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../..",
);
const SETTLEMENTS_FILE = path.join(PROJECT_ROOT, "data/settlements.json");
const SRC_DIR = path.join(PROJECT_ROOT, "data/funds/projects/by-muni");
const OUT_DIR = path.join(PROJECT_ROOT, "data/funds/projects/by-muni-geo");

// Cap contracts per município — the map can only render so many pins anyway
// (Sofia would otherwise produce ~30k, un-clusterable in Leaflet without a
// plugin) and the list stays scrollable. Top-N by totalEur preserves the
// most-significant projects for both views.
const CONTRACTS_PER_MUNI_CAP = 200;

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
    let geocodedCount = 0;
    const enriched: GeoContract[] = contracts.map((c) => {
      const ekatte = c.location?.ekatte ?? undefined;
      const ll = ekatte ? ekatteToLatLon.get(ekatte) : undefined;
      if (ll) geocodedCount += 1;
      return {
        contractNumber: c.contractNumber,
        title: c.title,
        totalEur: c.totalEur ?? 0,
        status: c.status,
        programName: c.programName,
        ...(ll ? { ekatte, lat: ll[0], lon: ll[1] } : {}),
      };
    });
    // Top-N by totalEur. Sort desc; the larger projects are the ones a user
    // is most likely to want to know about. Geocoded and non-geocoded share
    // one ranking so the list and the map are drawn from the same set.
    enriched.sort((a, b) => b.totalEur - a.totalEur);
    const trimmed = enriched.slice(0, CONTRACTS_PER_MUNI_CAP);
    const out: GeoFile = {
      obshtina,
      generatedAt: new Date().toISOString(),
      sourceContractCount: contracts.length,
      geocodedCount,
      contracts: trimmed,
    };
    fs.writeFileSync(
      path.join(OUT_DIR, `${obshtina}.json`),
      JSON.stringify(out, null, 2) + "\n",
    );
    totalOut += trimmed.length;
  }
  console.log(
    `Wrote ${files.length} per-município geo files, ${totalIn} contracts in → ${totalOut} contracts out (cap ${CONTRACTS_PER_MUNI_CAP}/município)`,
  );
};

main();
