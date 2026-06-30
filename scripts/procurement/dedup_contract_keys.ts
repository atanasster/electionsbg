// One-shot: re-key contracts whose 12-hex `key` collides with a DISTINCT row,
// then re-run every downstream procurement builder so rollups, per-entity lists,
// the contract_index, by-id stores, by_ns / by-settlement shards and the index
// all carry the corrected keys. No network calls — works purely from
// data/procurement/ on disk (data.egov.bg is host-IP-blocked).
//
//   npx tsx scripts/procurement/dedup_contract_keys.ts            # fix + rebuild
//   npx tsx scripts/procurement/dedup_contract_keys.ts --dry-run  # report only
//
// Background: the contract `key` is the SPA's row identity (/contract/:key) and
// every per-entity contracts list keys its React rows on it. The legacy-CSV key
// formula (legacy::dataset::documentId::eik) omitted the per-contract id, so two
// lots / обособени позиции under one document number — distinct contracts, with
// distinct contractId — minted the SAME key. Because the legacy shard-merge key
// included contractId, both survived on disk sharing one `key`: React warned
// "two children with the same key" and /contract/:key kept only one of them.
//
// disambiguateContractKeys (contract_key.ts) re-keys exactly those colliding
// rows — a base key shared by N distinct rows becomes hash(`${baseKey}::${disc}`)
// per row; the 98%+ non-colliding base keys keep their bare form so existing
// URLs never move. The same logic now runs inside all three generators, so a
// fresh ingest produces identical keys; this runner applies it corpus-wide to
// the already-ingested data without a re-fetch. Idempotent.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalJson, assertUniqueKeys } from "./validate";
import {
  disambiguateContractKeys,
  legacyKeyDiscriminator,
} from "./contract_key";
import { buildRollups, writeRollups } from "./rollups";
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
import { main as rebuildContractIndex } from "./contract_index";
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
const TR_SQLITE = path.resolve(__dirname, "../../raw_data/tr/state.sqlite");
const MP_CONNECTED_FILE = path.join(DERIVED_DIR, "mp_connected.json");
const ELECTIONS_INDEX = path.resolve(
  __dirname,
  "../../src/data/json/elections.json",
);

const DRY_RUN = process.argv.includes("--dry-run");

// --reuse-mp (default ON): the re-key only changes the `key` field — it touches
// no amounts and no contractor identity — so the published MP↔contractor roster
// (sensitive to the exact TR snapshot on disk) must stay byte-stable. We reuse
// it and refresh each entry's contract-derived totals from the rebuilt rollups
// (unchanged here, but kept for parity with dedup_legacy_twins.ts). Pass
// --recompute-mp to rebuild the roster from companies-index + TR namesake counts.
const RECOMPUTE_MP = process.argv.includes("--recompute-mp");

// rowSort — canonical on-disk order, mirrors ingest.ts.writeMonthShards so the
// rewritten shards stay byte-comparable to a fresh ingest.
const rowSort = (a: Contract, b: Contract): number => {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (a.ocid !== b.ocid) return a.ocid.localeCompare(b.ocid);
  return a.key.localeCompare(b.key);
};

// Phase 1 — load every month-shard, re-key colliding rows GLOBALLY (group by the
// stored base key across the whole corpus, so a group split across shards is
// still caught), then rewrite the shards that changed. Returns drop/rekey counts.
const rekeyShards = (): {
  shardsChanged: number;
  rowsRekeyed: number;
  collidingKeys: number;
} => {
  type Loaded = { file: string; rows: Contract[] };
  const shards: Loaded[] = [];
  const all: Contract[] = [];
  for (const year of fs.readdirSync(CONTRACTS_DIR).sort()) {
    if (!/^\d{4}$/.test(year)) continue;
    const yearDir = path.join(CONTRACTS_DIR, year);
    if (!fs.statSync(yearDir).isDirectory()) continue;
    for (const file of fs.readdirSync(yearDir).sort()) {
      if (!/^\d{4}-\d{2}\.json$/.test(file)) continue;
      const full = path.join(yearDir, file);
      const rows = JSON.parse(fs.readFileSync(full, "utf8")) as Contract[];
      shards.push({ file: full, rows });
      for (const r of rows) all.push(r);
    }
  }

  // Count colliding keys before (distinct rows sharing one key) for the report.
  const idxsByKey = new Map<string, number>();
  for (const r of all) idxsByKey.set(r.key, (idxsByKey.get(r.key) ?? 0) + 1);
  const collidingKeys = [...idxsByKey.values()].filter((n) => n > 1).length;

  // Re-key in place. legacyKeyDiscriminator reads (contractId, amount) — the
  // exact discriminator legacy_csv.ts feeds the generator-side pass, so the
  // resulting keys match a fresh ingest byte-for-byte. OCDS/eop rows never
  // collide on disk, so the discriminator is only ever consulted for legacy rows.
  const rowsRekeyed = disambiguateContractKeys(all, (i) =>
    legacyKeyDiscriminator(all[i]),
  );

  // Rewrite the shards whose canonical text changed (re-sort by the new keys).
  let shardsChanged = 0;
  if (!DRY_RUN) {
    for (const { file, rows } of shards) {
      rows.sort(rowSort);
      assertUniqueKeys(rows, path.basename(file));
      const next = canonicalJson(rows);
      const prev = fs.readFileSync(file, "utf8");
      if (next === prev) continue;
      fs.writeFileSync(file, next);
      shardsChanged++;
    }
  }
  return { shardsChanged, rowsRekeyed, collidingKeys };
};

// Reuse the published MP roster, refreshing each entry's contract-derived fields
// from the rebuilt contractor rollups. Identity + relations stay byte-stable.
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
    `→ phase 1: re-keying colliding contracts across month-shards${DRY_RUN ? " (dry run)" : ""}`,
  );
  const rk = rekeyShards();
  console.log(
    `  ${rk.collidingKeys} colliding key(s) found; re-keyed ${rk.rowsRekeyed} row(s) ` +
      `across ${rk.shardsChanged} rewritten shard(s)`,
  );

  if (DRY_RUN) {
    console.log("✓ dry run — no shards written, rebuild skipped");
    return;
  }
  if (rk.rowsRekeyed === 0) {
    console.log("  corpus already clean — rebuilding anyway for consistency");
  }

  // Phase 2 — full offline rebuild. Mirrors the post-shard steps of ingest.ts
  // main(): rollups → per-entity → cpv → pep → MP cross-reference → derived →
  // by_ns → by-id → slim feeds → by-settlement → contract_index → index.
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
      "→ reusing published MP roster (re-key changes no totals; pass --recompute-mp to rebuild it)",
    );
    mpConnected = reuseMpRosterRefreshTotals();
    writeMpConnected(DERIVED_DIR, mpConnected);
    console.log(`  ${mpConnected.entries.length} MP↔contractor pair(s)`);
  } else if (fs.existsSync(COMPANIES_INDEX)) {
    console.log("→ cross-referencing contractors against MP-companies graph");
    const trNamesake = buildTrNamesakeCounts(TR_SQLITE);
    if (trNamesake.size === 0) {
      console.log("  WARNING: TR SQLite absent — MP namesake filter skipped");
    }
    const linkageMap = buildEikLinkageMap(COMPANIES_INDEX, trNamesake);
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
      `  top_contractors.json: ${top.entries.length}; flow.json: ${flow.links.length} link(s)`,
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
    `  by_settlement/: ${bs.settlementFiles} settlement file(s), ${bs.nationalAwarders} national`,
  );

  // contract_index/<year>.json embeds `key` for the faceted browser's deep-links
  // — rebuild it so the re-keyed rows resolve.
  console.log("→ rebuilding faceted contract_index");
  rebuildContractIndex();

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
      `€${(idx.totals.totalEur / 1e9).toFixed(3)}bn. Re-key rebuild complete.`,
  );
  console.log(
    "  next: bucket-sync data/procurement/ to GCS (npm run bucket:sync:all or the procurement upload path).",
  );
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
