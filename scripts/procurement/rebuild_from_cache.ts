// One-shot: backfill `amountEur` onto every cached contract month-shard, then
// re-run every downstream procurement builder so rollups, per-entity contract
// lists, cross-reference, derived files and the index all pick up the euro
// fields. No network calls — works purely from data/procurement/ on disk.
//
// Use after the euro migration (src/lib/currency.ts) so the existing corpus
// gets `amountEur` / `totalEur` / `totalOther` without a full re-ingest.
//
//   npx tsx scripts/procurement/rebuild_from_cache.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { toEur } from "@/lib/currency";
import { canonicalJson } from "./validate";
import { buildRollups, writeRollups } from "./rollups";
import {
  buildEikLinkageMap,
  buildMpConnected,
  writeMpConnected,
} from "./cross_reference";
import {
  buildAwarderConcentration,
  buildFlow,
  buildTopContractors,
  writeDerived,
} from "./derived";
import { buildPepConnected, writePepConnected } from "./pep_connected";
import { writeByIdContracts } from "./by_id";
import { writeContractorContracts } from "./contractor_contracts";
import { writeAwarderContracts } from "./awarder_contracts";
import { buildByNs } from "./by_ns";
import { buildBySettlement } from "./by_settlement";
import type { BundlesIndex, Contract, ProcurementIndex } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");
const CONTRACTORS_DIR = path.join(PROCUREMENT_DIR, "contractors");
const AWARDERS_DIR = path.join(PROCUREMENT_DIR, "awarders");
const CONTRACTOR_CONTRACTS_DIR = path.join(
  PROCUREMENT_DIR,
  "contractor_contracts",
);
const AWARDER_CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "awarder_contracts");
const DERIVED_DIR = path.join(PROCUREMENT_DIR, "derived");
const BY_NS_DIR = path.join(PROCUREMENT_DIR, "by_ns");
const INDEX_FILE = path.join(PROCUREMENT_DIR, "index.json");
const BUNDLES_FILE = path.join(PROCUREMENT_DIR, "bundles.json");
const COMPANIES_INDEX = path.resolve(
  __dirname,
  "../../data/parliament/companies-index.json",
);
const OFFICIALS_COMPANY_LINKS = path.resolve(
  __dirname,
  "../../data/officials/derived/company_links.json",
);
const ELECTIONS_INDEX = path.resolve(
  __dirname,
  "../../src/data/json/elections.json",
);

// 1. Backfill amountEur onto every contract row in every month-shard.
const migrateShards = (): { files: number; rows: number } => {
  let files = 0;
  let rows = 0;
  if (!fs.existsSync(CONTRACTS_DIR)) return { files, rows };
  for (const year of fs.readdirSync(CONTRACTS_DIR).sort()) {
    if (!/^\d{4}$/.test(year)) continue;
    const yearDir = path.join(CONTRACTS_DIR, year);
    if (!fs.statSync(yearDir).isDirectory()) continue;
    for (const file of fs.readdirSync(yearDir)) {
      if (!/^\d{4}-\d{2}\.json$/.test(file)) continue;
      const full = path.join(yearDir, file);
      const shard = JSON.parse(fs.readFileSync(full, "utf8")) as Contract[];
      for (const row of shard) {
        row.amountEur = toEur(row.amount, row.currency) ?? undefined;
        rows++;
      }
      fs.writeFileSync(full, canonicalJson(shard));
      files++;
    }
  }
  return { files, rows };
};

const main = async (): Promise<void> => {
  console.log("→ backfilling amountEur onto contract month-shards");
  const migrated = migrateShards();
  console.log(
    `  ${migrated.files} shard(s), ${migrated.rows} contract row(s) updated`,
  );

  console.log("→ rebuilding contractor/awarder rollups");
  const rollups = buildRollups(CONTRACTS_DIR);
  const { contractorFiles, awarderFiles } = writeRollups(
    PROCUREMENT_DIR,
    rollups,
  );
  console.log(
    `  ${contractorFiles} contractor file(s), ${awarderFiles} awarder file(s)`,
  );

  console.log("→ writing per-contractor contracts files");
  const cc = writeContractorContracts(CONTRACTS_DIR, CONTRACTOR_CONTRACTS_DIR);
  console.log(`  contractor_contracts/: ${cc.filesWritten} file(s)`);

  console.log("→ writing per-awarder contracts files");
  const ac = writeAwarderContracts(CONTRACTS_DIR, AWARDER_CONTRACTS_DIR);
  console.log(`  awarder_contracts/: ${ac.filesWritten} file(s)`);

  // by-settlement maps (geo-resolved awarders → settlement). Reads the awarder
  // rollups just written above; awarders with no address won't pin to an EKATTE.
  console.log("→ rebuilding by-settlement maps");
  const bs = await buildBySettlement();
  console.log(
    `  by_settlement/: ${bs.settlementFiles} file(s); ${bs.localAwardersPinned} local awarder(s) pinned`,
  );

  // Officials (non-MP political class) → procurement. Independent of the
  // companies-index gate below (uses the officials declarations tree).
  const pepConnected = buildPepConnected(
    OFFICIALS_COMPANY_LINKS,
    CONTRACTORS_DIR,
  );
  writePepConnected(DERIVED_DIR, pepConnected);
  console.log(
    `  pep_connected.json: ${pepConnected.total} pair(s), ${pepConnected.officialCount} official(s)`,
  );
  const offSlugs = new Set<string>();
  const offByEik = new Map<string, number>();
  for (const e of pepConnected.entries) {
    offSlugs.add(e.slug);
    if (!offByEik.has(e.contractorEik))
      offByEik.set(e.contractorEik, e.totalEur);
  }
  let officialsTotalEur = 0;
  for (const v of offByEik.values()) officialsTotalEur += v;
  const officialsCrossRefSummary: ProcurementIndex["officialsCrossReference"] =
    pepConnected.entries.length > 0
      ? {
          generatedAt: new Date().toISOString(),
          officialCount: offSlugs.size,
          contractorCount: offByEik.size,
          pairCount: pepConnected.entries.length,
          totalEur: officialsTotalEur,
        }
      : undefined;

  let crossRefSummary: ProcurementIndex["crossReference"] | undefined;
  if (fs.existsSync(COMPANIES_INDEX)) {
    console.log("→ cross-referencing contractors against MP-companies graph");
    const linkageMap = buildEikLinkageMap(COMPANIES_INDEX);
    const mpConnected = buildMpConnected(CONTRACTORS_DIR, linkageMap);
    writeMpConnected(DERIVED_DIR, mpConnected);
    console.log(`  ${mpConnected.entries.length} MP↔contractor pair(s)`);

    const top = buildTopContractors(CONTRACTORS_DIR, mpConnected);
    const flow = buildFlow(AWARDERS_DIR, mpConnected, pepConnected);
    const concentration = buildAwarderConcentration(AWARDERS_DIR);
    writeDerived(DERIVED_DIR, top, flow, concentration);
    console.log(
      `  top_contractors.json: ${top.entries.length} entries; flow.json: ${flow.links.length} link(s)`,
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
      console.log(`  by_ns/: ${byNs.files} per-election file(s)`);
    }

    const byId = writeByIdContracts(
      PROCUREMENT_DIR,
      CONTRACTS_DIR,
      mpConnected,
    );
    console.log(`  by-id contracts: ${byId.emitted} file(s)`);

    let totalEur = 0;
    const totalOther: Record<string, number> = {};
    const mpSet = new Set<number>();
    const contractorSet = new Set<string>();
    for (const e of mpConnected.entries) {
      mpSet.add(e.mpId);
      contractorSet.add(e.contractorEik);
      totalEur += e.totalEur;
      for (const [cur, amt] of Object.entries(e.totalOther)) {
        totalOther[cur] = (totalOther[cur] ?? 0) + amt;
      }
    }
    crossRefSummary = {
      generatedAt: new Date().toISOString(),
      mpCount: mpSet.size,
      contractorCount: contractorSet.size,
      pairCount: mpConnected.entries.length,
      totalEur,
      totalOther,
    };
  } else {
    console.log("  companies-index.json missing — skipping cross-reference");
  }

  // Rewrite index.json — totals come from the fresh rollup pass.
  const bundles: BundlesIndex | null = fs.existsSync(BUNDLES_FILE)
    ? (JSON.parse(fs.readFileSync(BUNDLES_FILE, "utf8")) as BundlesIndex)
    : null;
  const years = new Set<string>();
  const months = new Set<string>();
  for (const y of fs.readdirSync(CONTRACTS_DIR)) {
    if (!/^\d{4}$/.test(y)) continue;
    years.add(y);
    for (const f of fs.readdirSync(path.join(CONTRACTS_DIR, y))) {
      const m = f.match(/^(\d{4}-\d{2})\.json$/);
      if (m) months.add(m[1]);
    }
  }
  const idx: ProcurementIndex = {
    generatedAt: new Date().toISOString(),
    lastIngest: new Date().toISOString(),
    years: [...years].sort(),
    months: [...months].sort(),
    totals: rollups.totals,
    periods: (bundles?.entries ?? []).map((b) => ({
      bundleUuid: b.datasetUuid,
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
    })),
    ...(crossRefSummary ? { crossReference: crossRefSummary } : {}),
    ...(officialsCrossRefSummary
      ? { officialsCrossReference: officialsCrossRefSummary }
      : {}),
  };
  fs.writeFileSync(INDEX_FILE, canonicalJson(idx));
  console.log("✓ index.json rewritten — procurement rebuild complete");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
