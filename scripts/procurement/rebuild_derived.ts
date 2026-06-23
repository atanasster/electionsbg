// Standalone runner: rebuilds the procurement DERIVED artifacts that depend on
// the person↔company link tables (pep_connected, mp_connected + their shards,
// top_contractors, flow, by_ns, by-id contracts, risk_feed, concentration_full,
// person_procurement_index) from whatever is already on disk — no network, no
// re-parse of the contract corpus.
//
// The normal path is `scripts/procurement/ingest.ts` (its no-new-bundles branch
// does exactly this). Use this runner when data.egov.bg is unreachable (the AOP
// org listing 403s during a host-level IP block) but the link tables changed and
// the derived feeds need to catch up. Contract month-shards, contractor/awarder
// rollups and the CPV baseline are link-independent and are left untouched.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildEikLinkageMap,
  buildMpConnected,
  buildTrNamesakeCounts,
  writeMpConnected,
} from "./cross_reference";
import {
  buildAwarderConcentration,
  buildFlow,
  buildTopContractors,
  writeDerived,
} from "./derived";
import { buildPepConnected, writePepConnected } from "./pep_connected";
import {
  buildRiskFeed,
  writeRiskFeed,
  buildPersonIndex,
  writePersonIndex,
  buildConcentrationFull,
  writeConcentrationFull,
} from "./risk_feed";
import { writeByIdContracts } from "./by_id";
import { writeByIdShards } from "./by_id_shards";
import { buildByNs } from "./by_ns";
import type { MpConnectedFile, ProcurementIndex } from "./types";

// --reuse-mp: load the existing mp_connected.json instead of recomputing it
// from companies-index + the TR-namesake filter. Use this when ONLY the
// officials side changed (e.g. wiring pep_connected into flow/by_ns) so the
// published MP figures stay byte-stable and the namesake filter — which is
// sensitive to the exact TR snapshot on disk — can't silently shift them.
const REUSE_MP = process.argv.includes("--reuse-mp");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");
const CONTRACTORS_DIR = path.join(PROCUREMENT_DIR, "contractors");
const AWARDERS_DIR = path.join(PROCUREMENT_DIR, "awarders");
const DERIVED_DIR = path.join(PROCUREMENT_DIR, "derived");
const BY_NS_DIR = path.join(PROCUREMENT_DIR, "by_ns");
const INDEX_FILE = path.join(PROCUREMENT_DIR, "index.json");
const COMPANIES_INDEX = path.resolve(
  __dirname,
  "../../data/parliament/companies-index.json",
);
const OFFICIALS_COMPANY_LINKS = path.resolve(
  __dirname,
  "../../data/officials/derived/company_links.json",
);
const TR_SQLITE = path.resolve(__dirname, "../../raw_data/tr/state.sqlite");
const MP_CONNECTED_FILE = path.join(DERIVED_DIR, "mp_connected.json");
const ELECTIONS_INDEX = path.resolve(
  __dirname,
  "../../src/data/json/elections.json",
);

// Officials (non-MP) → procurement.
const pepConnected = buildPepConnected(
  OFFICIALS_COMPANY_LINKS,
  CONTRACTORS_DIR,
);
writePepConnected(DERIVED_DIR, pepConnected);
console.log(
  `pep_connected.json: ${pepConnected.total} pair(s), ${pepConnected.officialCount} official(s)`,
);

// MPs → procurement. Either reuse the on-disk mp_connected.json (--reuse-mp)
// or recompute it from companies-index + the TR-namesake filter.
let mpConnected: MpConnectedFile | null = null;
let recomputedMp = false;
if (REUSE_MP && fs.existsSync(MP_CONNECTED_FILE)) {
  mpConnected = JSON.parse(
    fs.readFileSync(MP_CONNECTED_FILE, "utf8"),
  ) as MpConnectedFile;
  console.log(
    `mp_connected.json: reused ${mpConnected.entries.length} pair(s) from disk (--reuse-mp)`,
  );
} else if (fs.existsSync(COMPANIES_INDEX)) {
  const trNamesake = buildTrNamesakeCounts(TR_SQLITE);
  if (trNamesake.size === 0) {
    console.log("  WARNING: TR SQLite absent — MP namesake filter skipped");
  }
  const linkageMap = buildEikLinkageMap(COMPANIES_INDEX, trNamesake);
  mpConnected = buildMpConnected(CONTRACTORS_DIR, linkageMap);
  writeMpConnected(DERIVED_DIR, mpConnected);
  recomputedMp = true;
  console.log(
    `mp_connected.json: ${mpConnected.entries.length} MP↔contractor pair(s)`,
  );
}

if (mpConnected) {
  const top = buildTopContractors(CONTRACTORS_DIR, mpConnected);
  const flow = buildFlow(AWARDERS_DIR, mpConnected, pepConnected);
  const concentration = buildAwarderConcentration(AWARDERS_DIR);
  writeDerived(DERIVED_DIR, top, flow, concentration);
  console.log(
    `top_contractors.json: ${top.entries.length}; flow.json: ${flow.links.length} link(s)`,
  );

  if (fs.existsSync(ELECTIONS_INDEX)) {
    const elections = JSON.parse(
      fs.readFileSync(ELECTIONS_INDEX, "utf8"),
    ) as Array<{ name: string }>;
    const byNs = buildByNs({
      contractsDir: CONTRACTS_DIR,
      mpConnected,
      pepConnected,
      outDir: BY_NS_DIR,
      elections,
    });
    console.log(`by_ns/: ${byNs.files} file(s)`);
  }

  const byId = writeByIdContracts(PROCUREMENT_DIR, CONTRACTS_DIR, mpConnected);
  console.log(
    `by-id contracts: ${byId.emitted} (${byId.mpTied} MP-tied, ${byId.removed} pruned)`,
  );

  const byIdShards = writeByIdShards(PROCUREMENT_DIR, CONTRACTS_DIR);
  console.log(
    `by-id shards: ${byIdShards.contracts.toLocaleString()} contract(s) → ${byIdShards.shards} shard(s)`,
  );

  // Refresh the index.json crossReference summary in place (keep totals/periods).
  let totalEur = 0;
  const totalOther: Record<string, number> = {};
  const mpSet = new Set<number>();
  const contractorSet = new Set<string>();
  for (const e of mpConnected.entries) {
    mpSet.add(e.mpId);
    contractorSet.add(e.contractorEik);
    totalEur += e.totalEur;
    for (const [cur, amt] of Object.entries(e.totalOther))
      totalOther[cur] = (totalOther[cur] ?? 0) + amt;
  }
  // Officials cross-reference summary for the full-corpus (all-years) view.
  // De-dup by contractor EIK so a company tied to several officials counts its
  // euro total once — sidesteps the per-pair double-count of pep_connected.
  const offSlugs = new Set<string>();
  const offByEik = new Map<string, number>();
  for (const e of pepConnected.entries) {
    offSlugs.add(e.slug);
    if (!offByEik.has(e.contractorEik))
      offByEik.set(e.contractorEik, e.totalEur);
  }
  let officialsTotalEur = 0;
  for (const v of offByEik.values()) officialsTotalEur += v;

  if (fs.existsSync(INDEX_FILE)) {
    const idx = JSON.parse(
      fs.readFileSync(INDEX_FILE, "utf8"),
    ) as ProcurementIndex;
    // Only overwrite the MP crossReference when we actually recomputed it;
    // when reusing, leave the committed summary untouched.
    if (recomputedMp) {
      idx.crossReference = {
        generatedAt: new Date().toISOString(),
        mpCount: mpSet.size,
        contractorCount: contractorSet.size,
        pairCount: mpConnected.entries.length,
        totalEur,
        totalOther,
      };
    }
    idx.officialsCrossReference = {
      generatedAt: new Date().toISOString(),
      officialCount: offSlugs.size,
      contractorCount: offByEik.size,
      pairCount: pepConnected.entries.length,
      totalEur: officialsTotalEur,
    };
    fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2) + "\n");
    console.log(
      `index.json crossReference: ${recomputedMp ? `${mpSet.size} MP(s), ${contractorSet.size} firm(s), €${(totalEur / 1e6).toFixed(0)}M` : "kept (reused)"}; ` +
        `officials: ${offSlugs.size} official(s), ${offByEik.size} firm(s), €${(officialsTotalEur / 1e6).toFixed(0)}M`,
    );
  }
} else {
  console.log(
    "no mp_connected.json (reuse) and companies-index.json missing — MP cross-reference skipped",
  );
}

// Slim feeds (read the just-written derived files).
const riskFeed = buildRiskFeed(DERIVED_DIR);
writeRiskFeed(DERIVED_DIR, riskFeed);
const concFull = buildConcentrationFull(DERIVED_DIR);
writeConcentrationFull(DERIVED_DIR, concFull);
const personIndex = buildPersonIndex(DERIVED_DIR);
writePersonIndex(DERIVED_DIR, personIndex);
console.log(
  `risk_feed.json: ${riskFeed.topConcentration.length} conc + ${riskFeed.topMpTied.length} mp-tied; ` +
    `concentration_full.json: ${concFull.total}; person_procurement_index.json: ${personIndex.total}`,
);
