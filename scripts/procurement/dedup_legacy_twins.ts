// One-shot: strip synthetic legacy "-x" twin rows from the contract corpus,
// then re-run every downstream procurement builder so rollups, per-entity
// lists, derived files, by_ns/by-settlement shards and the index all reflect
// the de-duplicated corpus. No network calls — works purely from
// data/procurement/ on disk (data.egov.bg is host-IP-blocked).
//
//   npx tsx scripts/procurement/dedup_legacy_twins.ts            # clean + rebuild
//   npx tsx scripts/procurement/dedup_legacy_twins.ts --dry-run  # report only
//
// Background: an earlier legacy-CSV ingest (with a less complete column map)
// emitted blank-document-id rows that got the `…-x` ocid fallback. A later
// run re-ingested the same contracts correctly with their real document number.
// Because the shard merge keys on `key` (which embeds the document id), the two
// never collapsed — leaving ~34k duplicate pairs that double-count ~€11bn of
// spend across 2016/2017/2019/2021. dropSyntheticLegacyTwins (validate.ts)
// drops the `-x` member of each pair; this runner applies it corpus-wide and
// rebuilds. The same dedup is now wired into both writeMonthShards paths, so
// future ingests stay clean.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalJson, dropSyntheticLegacyTwins } from "./validate";
import { buildRollups, writeRollups } from "./rollups";
import {
  buildMpConnected,
  buildNamesakeFilteredLinkageMap,
  writeMpConnected,
} from "./cross_reference";
import {
  buildAwarderConcentration,
  buildFlow,
  buildTopContractors,
  writeDerived,
} from "./derived";
import { buildCpvCompetition, writeCpvCompetition } from "./cpv_competition";
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
import { writeContractorContracts } from "./contractor_contracts";
import { writeAwarderContracts } from "./awarder_contracts";
import { buildByNs } from "./by_ns";
import { buildBySettlement } from "./by_settlement";
import type {
  BundlesIndex,
  Contract,
  ContractorRollup,
  MpConnectedFile,
  ProcurementIndex,
} from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
const MP_CONNECTED_FILE = path.join(DERIVED_DIR, "mp_connected.json");
const ELECTIONS_INDEX = path.resolve(
  __dirname,
  "../../src/data/json/elections.json",
);

const DRY_RUN = process.argv.includes("--dry-run");

// --reuse-mp (default ON): keep the published MP↔contractor namesake ROSTER
// byte-stable (the set of mpId/contractorEik pairs + their relations, last
// regenerated in the namesake-fix commit) and only refresh each entry's
// contract-derived totals from the freshly de-duplicated rollups. The namesake
// filter is sensitive to the exact TR snapshot on disk, so a full recompute can
// silently shift the published "N MPs tied to procurement" headline for reasons
// unrelated to this de-dup. This task only removes duplicate contracts, so we
// keep the roster and correct the inflated euro totals.
//
// Pass --recompute-mp to instead recompute the roster from companies-index +
// the current TR namesake counts (the default behaviour of ingest.ts /
// rebuild_derived.ts).
const RECOMPUTE_MP = process.argv.includes("--recompute-mp");

// Phase 1 — walk every month-shard, drop synthetic `-x` twins, rewrite the
// shards that changed. Returns per-year + total drop counts.
const cleanShards = (): {
  shardsChanged: number;
  totalDropped: number;
  byYear: Record<string, number>;
} => {
  let shardsChanged = 0;
  let totalDropped = 0;
  const byYear: Record<string, number> = {};
  for (const year of fs.readdirSync(CONTRACTS_DIR).sort()) {
    if (!/^\d{4}$/.test(year)) continue;
    const yearDir = path.join(CONTRACTS_DIR, year);
    if (!fs.statSync(yearDir).isDirectory()) continue;
    for (const file of fs.readdirSync(yearDir).sort()) {
      if (!/^\d{4}-\d{2}\.json$/.test(file)) continue;
      const full = path.join(yearDir, file);
      const rows = JSON.parse(fs.readFileSync(full, "utf8")) as Contract[];
      const { rows: kept, dropped } = dropSyntheticLegacyTwins(rows);
      if (dropped === 0) continue;
      totalDropped += dropped;
      byYear[year] = (byYear[year] ?? 0) + dropped;
      shardsChanged++;
      if (!DRY_RUN) fs.writeFileSync(full, canonicalJson(kept));
    }
  }
  return { shardsChanged, totalDropped, byYear };
};

// Reuse the published MP roster but refresh each entry's contract-derived
// fields (totalEur/contractCount/byYear/topAwarders) from the freshly
// de-duplicated contractor rollups. Identity + relations stay byte-stable; only
// the inflated euro totals get corrected. A roster entry whose contractor file
// vanished (should not happen — every `-x` twin shares its real twin's EIK) is
// kept verbatim.
const reuseMpRosterRefreshTotals = (): MpConnectedFile => {
  const committed = JSON.parse(
    fs.readFileSync(MP_CONNECTED_FILE, "utf8"),
  ) as MpConnectedFile;
  const rollupCache = new Map<string, ContractorRollup | null>();
  const readRollup = (eik: string): ContractorRollup | null => {
    if (rollupCache.has(eik)) return rollupCache.get(eik)!;
    const p = path.join(CONTRACTORS_DIR, `${eik}.json`);
    const c = fs.existsSync(p)
      ? (JSON.parse(fs.readFileSync(p, "utf8")) as ContractorRollup)
      : null;
    rollupCache.set(eik, c);
    return c;
  };
  const entries = committed.entries.map((e) => {
    const c = readRollup(e.contractorEik);
    if (!c) return e;
    return {
      ...e,
      totalEur: c.totalEur,
      totalOther: c.totalOther,
      contractCount: c.contractCount,
      awardCount: c.awardCount,
      byYear: c.byYear,
      topAwarders: c.byAwarder.slice(0, 5),
    };
  });
  entries.sort((a, b) => b.totalEur - a.totalEur);
  return {
    generatedAt: new Date().toISOString(),
    total: entries.length,
    entries,
  };
};

const main = async (): Promise<void> => {
  console.log(
    `→ phase 1: stripping synthetic legacy "-x" twins from month-shards${DRY_RUN ? " (dry run)" : ""}`,
  );
  const clean = cleanShards();
  console.log(
    `  dropped ${clean.totalDropped} twin row(s) across ${clean.shardsChanged} shard(s): ` +
      `${Object.entries(clean.byYear)
        .map(([y, n]) => `${y}=${n}`)
        .join(" ")}`,
  );

  if (DRY_RUN) {
    console.log("✓ dry run — no shards written, rebuild skipped");
    return;
  }
  if (clean.totalDropped === 0) {
    console.log("  corpus already clean — rebuilding anyway for consistency");
  }

  // Phase 2 — full offline rebuild. Mirrors the post-shard steps of
  // ingest.ts main(): rollups → per-entity → cpv → pep → MP cross-reference
  // (namesake-filtered) → derived → by_ns → by-id → slim feeds → by-settlement
  // → index. No network walk.
  console.log("→ phase 2: rebuilding contractor/awarder rollups");
  const rollups = buildRollups(CONTRACTS_DIR);
  const { contractorFiles, awarderFiles } = writeRollups(
    PROCUREMENT_DIR,
    rollups,
  );
  console.log(
    `  ${contractorFiles} contractor file(s), ${awarderFiles} awarder file(s); ` +
      `totals: ${rollups.totals.contracts} contract(s), €${(rollups.totals.totalEur / 1e9).toFixed(3)}bn`,
  );

  console.log("→ writing per-contractor contracts files");
  const cc = writeContractorContracts(CONTRACTS_DIR, CONTRACTOR_CONTRACTS_DIR);
  console.log(
    `  contractor_contracts/: ${cc.filesWritten} file(s), ${cc.pruned} pruned`,
  );

  console.log("→ writing per-awarder contracts files");
  const ac = writeAwarderContracts(CONTRACTS_DIR, AWARDER_CONTRACTS_DIR);
  console.log(
    `  awarder_contracts/: ${ac.filesWritten} file(s), ${ac.pruned} pruned`,
  );

  console.log("→ building CPV competition baseline");
  const cpvCompetition = buildCpvCompetition(CONTRACTS_DIR);
  writeCpvCompetition(DERIVED_DIR, cpvCompetition);
  console.log(
    `  cpv_competition.json: ${cpvCompetition.divisions.length} division(s)`,
  );

  console.log("→ building officials→procurement cross-reference");
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
  let mpConnected: MpConnectedFile | null = null;
  const canReuseMp = !RECOMPUTE_MP && fs.existsSync(MP_CONNECTED_FILE);
  if (canReuseMp) {
    console.log(
      "→ reusing published MP roster, refreshing totals from de-duped rollups",
    );
    mpConnected = reuseMpRosterRefreshTotals();
    writeMpConnected(DERIVED_DIR, mpConnected);
    console.log(
      `  ${mpConnected.entries.length} MP↔contractor pair(s) (roster preserved; pass --recompute-mp to rebuild it)`,
    );
  } else if (fs.existsSync(COMPANIES_INDEX)) {
    console.log("→ cross-referencing contractors against MP-companies graph");
    const linkageMap = buildNamesakeFilteredLinkageMap(COMPANIES_INDEX);
    mpConnected = buildMpConnected(CONTRACTORS_DIR, linkageMap);
    writeMpConnected(DERIVED_DIR, mpConnected);
    console.log(`  ${mpConnected.entries.length} MP↔contractor pair(s)`);
  }

  if (mpConnected) {
    const top = buildTopContractors(CONTRACTORS_DIR, mpConnected);
    const flow = buildFlow(AWARDERS_DIR, mpConnected, pepConnected);
    const concentration = buildAwarderConcentration(AWARDERS_DIR);
    writeDerived(DERIVED_DIR, top, flow, concentration);
    console.log(
      `  top_contractors.json: ${top.entries.length}; flow.json: ${flow.links.length} link(s); ` +
        `awarder_concentration.json: ${concentration.total} pair(s)`,
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
    console.log(
      `  by-id contracts: ${byId.emitted} file(s) (${byId.mpTied} MP-tied, ${byId.removed} pruned)`,
    );

    const byIdShards = writeByIdShards(PROCUREMENT_DIR, CONTRACTS_DIR);
    console.log(
      `  by-id shards: ${byIdShards.contracts.toLocaleString()} contract(s) → ${byIdShards.shards} shard(s)`,
    );

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
    crossRefSummary = {
      generatedAt: new Date().toISOString(),
      mpCount: mpSet.size,
      contractorCount: contractorSet.size,
      pairCount: mpConnected.entries.length,
      totalEur,
      totalOther,
    };
  } else {
    console.log(
      "  no MP roster to reuse and companies-index.json missing — skipping MP cross-reference",
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
    `  risk_feed.json: ${riskFeed.topConcentration.length} conc + ${riskFeed.topMpTied.length} mp-tied; ` +
      `concentration_full.json: ${concFull.total}; person_procurement_index.json: ${personIndex.total}`,
  );

  console.log("→ building per-settlement procurement shards");
  const bs = await buildBySettlement();
  console.log(
    `  by_settlement/: ${bs.settlementFiles} settlement file(s), ${bs.nationalAwarders} national, ${bs.pruned} orphan(s) pruned`,
  );

  // Rewrite index.json — totals from the fresh rollup pass, periods from the
  // committed bundles index (no network re-walk).
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
  console.log(
    `✓ index.json rewritten — ${idx.totals.contracts} contract(s), ` +
      `€${(idx.totals.totalEur / 1e9).toFixed(3)}bn. Procurement rebuild complete.`,
  );
  console.log(
    "  next: bucket-sync data/procurement/ to GCS (npm run bucket:sync:all or the procurement upload path).",
  );
};

main();
