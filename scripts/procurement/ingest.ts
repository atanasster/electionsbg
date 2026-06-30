// Procurement ingest CLI. Pulls АОП fortnight bundles from data.egov.bg,
// normalizes each release into Contract rows, writes month-shards under
// data/procurement/contracts/<YYYY>/<YYYY-MM>.json, then rebuilds per-EIK
// rollups under contractors/ and awarders/.
//
// CLI:
//   tsx scripts/procurement/ingest.ts                    # incremental
//   tsx scripts/procurement/ingest.ts --since 2026-01-01 # backfill
//   tsx scripts/procurement/ingest.ts --bundle UUID      # one bundle only
//   tsx scripts/procurement/ingest.ts --refresh-cache    # re-download cached
//   tsx scripts/procurement/ingest.ts --upload           # rsync to bucket
//   tsx scripts/procurement/ingest.ts --dry-run          # parse, no writes

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { fetchBundlesIndex } from "./fetch_dataset_index";
import { fetchBundle } from "./fetch_bundle";
import { normalizeBundle } from "./normalize";
import {
  assertUniqueKeys,
  canonicalJson,
  checkDiffSize,
  countDomainFiles,
  dropSyntheticLegacyTwins,
  findHugeContracts,
  rowSort,
  runCanary,
  validateContract,
} from "./validate";
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
import { uploadText, uploadTextTree } from "../lib/upload";
import type {
  BundleEntry,
  BundlesIndex,
  Contract,
  ProcurementIndex,
} from "./types";

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
const TR_SQLITE = path.resolve(__dirname, "../../raw_data/tr/state.sqlite");
const ELECTIONS_INDEX = path.resolve(
  __dirname,
  "../../src/data/json/elections.json",
);
const CANARY_FIXTURE = path.resolve(
  __dirname,
  "../../tests/fixtures/procurement/canary.json",
);

// Canary bundle — pinned to the first fortnight whose normalizer output was
// hand-validated. Updated when the parser intentionally changes (delete the
// fixture file to re-seed).
const CANARY_BUNDLE_RESOURCE = "1b347ef4-4384-4e6c-95cd-d9f850d2c545";
const CANARY_BUNDLE_DATASET = "3edde0c3-80da-468c-8536-53db74680863";

const readBundlesIndex = (): BundlesIndex | null => {
  if (!fs.existsSync(BUNDLES_FILE)) return null;
  return JSON.parse(fs.readFileSync(BUNDLES_FILE, "utf8")) as BundlesIndex;
};

const writeBundlesIndex = (idx: BundlesIndex): void => {
  fs.mkdirSync(PROCUREMENT_DIR, { recursive: true });
  fs.writeFileSync(BUNDLES_FILE, canonicalJson(idx));
};

// Group rows by YYYY-MM and write/merge each month shard. Merging strategy:
// dedupe by the contract `key` — the disambiguated row identity (see
// contract_key.ts). The same row re-ingested from a later bundle (АОП sometimes
// republishes) hashes to the same key and replaces in place; genuinely distinct
// rows that once shared a base tuple now carry distinct keys and both survive.
const writeMonthShards = (
  rows: Contract[],
): { newFiles: number; modifiedFiles: number } => {
  if (rows.length === 0) return { newFiles: 0, modifiedFiles: 0 };
  const byMonth = new Map<string, Contract[]>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const arr = byMonth.get(month) ?? [];
    arr.push(r);
    byMonth.set(month, arr);
  }
  let newFiles = 0;
  let modifiedFiles = 0;
  for (const [month, freshRows] of byMonth) {
    const year = month.slice(0, 4);
    const dir = path.join(CONTRACTS_DIR, year);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${month}.json`);
    const existing: Contract[] = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, "utf8")) as Contract[])
      : [];
    const byKey = new Map<string, Contract>();
    for (const r of existing) byKey.set(r.key, r);
    for (const r of freshRows) byKey.set(r.key, r);
    // Drop synthetic legacy `-x` twins that duplicate a real row in the same
    // shard (see dropSyntheticLegacyTwins). Self-heals shards polluted by an
    // earlier ingest and prevents a re-introduced blank-document-id row from
    // double-counting against its real twin.
    const merged = dropSyntheticLegacyTwins([...byKey.values()]).rows.sort(
      rowSort,
    );
    assertUniqueKeys(merged, `${month}.json`);
    const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const next = canonicalJson(merged);
    if (next === prev) continue;
    fs.writeFileSync(file, next);
    if (prev == null) newFiles++;
    else modifiedFiles++;
  }
  return { newFiles, modifiedFiles };
};

const writeIndexJson = (
  bundles: BundleEntry[],
  contractsDir: string,
  totals: ProcurementIndex["totals"],
  crossReference?: ProcurementIndex["crossReference"],
  officialsCrossReference?: ProcurementIndex["officialsCrossReference"],
): void => {
  const years = new Set<string>();
  const months = new Set<string>();
  if (fs.existsSync(contractsDir)) {
    for (const y of fs.readdirSync(contractsDir)) {
      if (/^\d{4}$/.test(y)) {
        years.add(y);
        for (const f of fs.readdirSync(path.join(contractsDir, y))) {
          const m = f.match(/^(\d{4}-\d{2})\.json$/);
          if (m) months.add(m[1]);
        }
      }
    }
  }
  const idx: ProcurementIndex = {
    generatedAt: new Date().toISOString(),
    lastIngest: new Date().toISOString(),
    years: [...years].sort(),
    months: [...months].sort(),
    totals,
    periods: bundles.map((b) => ({
      bundleUuid: b.datasetUuid,
      periodStart: b.periodStart,
      periodEnd: b.periodEnd,
    })),
    ...(crossReference ? { crossReference } : {}),
    ...(officialsCrossReference ? { officialsCrossReference } : {}),
  };
  fs.writeFileSync(INDEX_FILE, canonicalJson(idx));
};

const main = async (args: {
  since?: string;
  bundle?: string;
  refreshCache: boolean;
  upload: boolean;
  dryRun: boolean;
  skipCanary: boolean;
  renormalize: boolean;
  maxBundles?: string;
}): Promise<void> => {
  fs.mkdirSync(PROCUREMENT_DIR, { recursive: true });

  // Snapshot baseline for diff-cap.
  const baselineFileCount = countDomainFiles(CONTRACTS_DIR);

  // 1. Resolve target bundles.
  let bundles: BundleEntry[];
  let previousBundles: BundleEntry[];
  const existingIndex = readBundlesIndex();
  previousBundles = existingIndex?.entries ?? [];

  if (args.renormalize) {
    // Re-normalize every already-ingested bundle from cache, applying the
    // current parser to existing rows (e.g. the bids.statistics fix). No
    // network walk; the cached bundles in raw_data/procurement/ are reused.
    // writeMonthShards merges by row key, so this overwrites rows in place
    // with the enriched fields without duplicating or dropping anything.
    bundles = previousBundles;
    console.log(
      `→ re-normalizing ${bundles.length} known bundle(s) from cache`,
    );
  } else if (args.bundle) {
    // Single-bundle path: caller passed a dataset UUID directly. Look it up
    // in the known index first, or re-resolve it from data.egov.bg if new.
    const known = previousBundles.find((b) => b.datasetUuid === args.bundle);
    if (known) {
      bundles = [known];
    } else {
      console.log(`→ resolving new bundle ${args.bundle} via dataset page`);
      const fresh = await fetchBundlesIndex({ maxPages: 50 });
      const hit = fresh.find((b) => b.datasetUuid === args.bundle);
      if (!hit)
        throw new Error(`dataset ${args.bundle} not found in АОП index`);
      bundles = [hit];
      previousBundles = mergeBundles(previousBundles, fresh);
    }
  } else {
    console.log(`→ walking АОП dataset listing`);
    const fresh = await fetchBundlesIndex({
      onPage: (page, collected) =>
        console.log(`  page ${page}: ${collected} bundle(s) collected`),
    });
    console.log(`  ${fresh.length} bundle(s) listed`);
    previousBundles = mergeBundles(previousBundles, fresh);
    // "Ingested" = at least one contract row from this bundle is on disk in
    // a month-shard. The discovered-bundle index (bundles.json) is NOT a
    // reliable signal — the walker writes to it on every run regardless of
    // whether the ingest actually normalized those bundles' data. Scanning
    // month-shards once per run is cheap (a few hundred KB total at current
    // volume) and gives ground truth.
    const ingestedUuids = collectIngestedBundleUuids(CONTRACTS_DIR);
    bundles = fresh.filter((b) => {
      if (args.since && b.periodEnd < args.since) return false;
      return !ingestedUuids.has(b.datasetUuid);
    });
    if (args.maxBundles) {
      const n = parseInt(args.maxBundles, 10);
      if (Number.isFinite(n) && n > 0) bundles = bundles.slice(0, n);
    }
  }

  // No new bundles: nothing to download, but we still rebuild rollups +
  // cross-reference + derived from whatever's on disk. This handles two
  // cases: (a) a partial prior run left rollups stale; (b) companies-index.json
  // changed and the cross-reference needs to re-run even without new contracts.
  // The early "✓ nothing to ingest" message is preserved when the contracts/
  // tree is also empty.
  const hasContractsOnDisk =
    fs.existsSync(CONTRACTS_DIR) &&
    fs.readdirSync(CONTRACTS_DIR).some((d) => /^\d{4}$/.test(d));
  if (bundles.length === 0 && !hasContractsOnDisk) {
    console.log("✓ nothing to ingest");
    writeBundlesIndex({
      fetchedAt: new Date().toISOString(),
      total: previousBundles.length,
      entries: previousBundles,
    });
    return;
  }

  if (bundles.length > 0) {
    console.log(`→ ingesting ${bundles.length} bundle(s)`);
  } else {
    console.log(
      `✓ all visible bundles already ingested — rebuilding rollups + cross-reference from disk`,
    );
  }

  // 2. Canary: validate the pinned bundle before any write. Skip when no new
  // bundles (rebuild-only path) — the rebuild touches existing data, not the
  // parser, so a canary check adds no signal.
  if (!args.skipCanary && bundles.length > 0) {
    if (!args.dryRun || fs.existsSync(CANARY_FIXTURE)) {
      console.log(`→ canary on bundle ${CANARY_BUNDLE_RESOURCE}`);
      const canaryBundle = await fetchBundle(CANARY_BUNDLE_RESOURCE, {
        refresh: args.refreshCache,
      });
      const { rows: canaryRows } = normalizeBundle(
        canaryBundle,
        CANARY_BUNDLE_DATASET,
      );
      canaryRows.forEach(validateContract);
      runCanary(CANARY_FIXTURE, canaryRows);
    } else {
      console.log(
        `  canary fixture missing — skipped (run without --dry-run to seed)`,
      );
    }
  }

  // 3. Fetch + normalize each target bundle.
  const allRows: Contract[] = [];
  let totalReleases = 0;
  for (const bundle of bundles) {
    console.log(
      `  • ${bundle.periodStart}…${bundle.periodEnd} (${bundle.datasetUuid})`,
    );
    const data = await fetchBundle(bundle.resourceUuid, {
      refresh: args.refreshCache,
    });
    const { rows, stats } = normalizeBundle(data, bundle.datasetUuid);
    totalReleases += stats.releasesSeen;
    rows.forEach(validateContract);
    const huge = findHugeContracts(rows);
    if (huge.length > 0) {
      console.log(`    ⚠ ${huge.length} row(s) ≥1B — review manually:`);
      for (const h of huge) {
        console.log(
          `      ${h.releaseId} ${h.contractorName} ${h.amount} ${h.currency}`,
        );
      }
    }
    console.log(
      `    ${stats.releasesSeen} release(s), emitted ${rows.length} row(s) ` +
        `(c=${stats.contractsEmitted} a=${stats.awardsEmitted} m=${stats.amendmentsEmitted}, dropped ${stats.rowsDroppedNoSupplierEik})`,
    );
    allRows.push(...rows);
  }

  if (args.dryRun) {
    console.log(
      `✓ dry run: ${allRows.length} row(s) across ${totalReleases} release(s) — not written`,
    );
    return;
  }

  // 4. Write month-shards.
  const { newFiles, modifiedFiles } = writeMonthShards(allRows);
  console.log(
    `→ wrote ${newFiles} new + ${modifiedFiles} modified month-shard(s)`,
  );

  // 5. Diff cap. Skipped on --renormalize: re-processing every bundle
  // intentionally rewrites a large share of the month-shards.
  if (!args.renormalize) {
    checkDiffSize(baselineFileCount, newFiles, modifiedFiles);
  }

  // 6. Rebuild rollups.
  console.log(`→ rebuilding contractor/awarder rollups`);
  const rollups = buildRollups(CONTRACTS_DIR);
  const { contractorFiles, awarderFiles } = writeRollups(
    PROCUREMENT_DIR,
    rollups,
  );
  console.log(
    `  ${contractorFiles} contractor file(s), ${awarderFiles} awarder file(s)`,
  );

  // 6b. Per-contractor full contract list — drives the SPA's company detail
  // page contracts table. One file per EIK with newest-first sort.
  console.log(`→ writing per-contractor contracts files`);
  const cc = writeContractorContracts(CONTRACTS_DIR, CONTRACTOR_CONTRACTS_DIR);
  console.log(
    `  contractor_contracts/: ${cc.filesWritten} file(s) covering ${cc.totalRows} row(s), ${cc.pruned} stale file(s) pruned`,
  );

  // 6c. Per-awarder full contract list — same shape, keyed on the buyer.
  // Drives the awarder detail page (/awarder/:eik).
  console.log(`→ writing per-awarder contracts files`);
  const ac = writeAwarderContracts(CONTRACTS_DIR, AWARDER_CONTRACTS_DIR);
  console.log(
    `  awarder_contracts/: ${ac.filesWritten} file(s) covering ${ac.totalRows} row(s), ${ac.pruned} stale file(s) pruned`,
  );

  // 6d. Per-CPV-division competition baseline (single-bid share). Derives from
  // the contract corpus only — not gated on the MP cross-reference — so the
  // single-bidder risk flag is conditioned on whether a CPV market is normally
  // competitive. See scripts/procurement/cpv_competition.ts.
  console.log(`→ building CPV competition baseline`);
  const cpvCompetition = buildCpvCompetition(CONTRACTS_DIR);
  writeCpvCompetition(DERIVED_DIR, cpvCompetition);
  console.log(
    `  cpv_competition.json: ${cpvCompetition.divisions.length} division(s)`,
  );

  // 6e. Officials (non-MP political class) → procurement cross-reference. Joins
  // the officials' high-confidence company links against the contractor set.
  // Not gated on companies-index (uses the officials declarations tree).
  console.log(`→ building officials→procurement cross-reference`);
  const pepConnected = buildPepConnected(
    OFFICIALS_COMPANY_LINKS,
    CONTRACTORS_DIR,
  );
  writePepConnected(DERIVED_DIR, pepConnected);
  console.log(
    `  pep_connected.json: ${pepConnected.total} pair(s), ${pepConnected.officialCount} official(s)`,
  );
  // Officials cross-reference summary for the index (full-corpus view). De-dup
  // by contractor EIK so a company tied to several officials counts its euro
  // total once. Independent of companies-index (officials use their own tree).
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

  // 7. Cross-reference against MP-companies graph + top-contractors + flow.
  // companies-index.json is optional — if it's missing, the procurement data
  // is still useful on its own (just without the journalism payload). The
  // /update-procurement skill SHOULD be paired with /update-connections, but
  // we don't hard-fail when the file is absent; we do hard-fail when it's
  // present but unenriched (see buildEikLinkageMap).
  let crossRefSummary: ProcurementIndex["crossReference"] | undefined;
  if (fs.existsSync(COMPANIES_INDEX)) {
    console.log(`→ cross-referencing contractors against MP-companies graph`);
    const trNamesake = buildTrNamesakeCounts(TR_SQLITE);
    if (trNamesake.size === 0) {
      console.log(
        `  no TR SQLite at ${path.relative(process.cwd(), TR_SQLITE)} — ` +
          `keeping all name-matched MP roles (namesake filter skipped)`,
      );
    }
    const linkageMap = buildEikLinkageMap(COMPANIES_INDEX, trNamesake);
    console.log(
      `  EIK linkage map: ${linkageMap.byEik.size} EIK(s) from ` +
        `${linkageMap.companiesWithUic}/${linkageMap.totalCompanies} TR-enriched companies`,
    );
    const mpConnected = buildMpConnected(CONTRACTORS_DIR, linkageMap);
    writeMpConnected(DERIVED_DIR, mpConnected);
    console.log(
      `  ${mpConnected.entries.length} MP↔contractor pair(s) emitted to derived/mp_connected.json`,
    );

    const top = buildTopContractors(CONTRACTORS_DIR, mpConnected);
    const flow = buildFlow(AWARDERS_DIR, mpConnected, pepConnected);
    const concentration = buildAwarderConcentration(AWARDERS_DIR);
    writeDerived(DERIVED_DIR, top, flow, concentration, CONTRACTORS_DIR);
    console.log(
      `  top_contractors.json: ${top.entries.length} entries (top of ${top.total}); ` +
        `flow.json: ${flow.nodes.length} node(s), ${flow.links.length} link(s); ` +
        `awarder_concentration.json: ${concentration.total} pair(s) ≥${(concentration.thresholdPct * 100).toFixed(0)}%`,
    );

    // Per-election (per-NS) pre-aggregates so the SPA's /procurement page
    // can default-filter to the selected parliament's date range without
    // walking the full corpus client-side.
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
      console.log(
        `  by_ns/: ${byNs.files} per-election file(s) across ${byNs.ranges.length} known election(s)`,
      );
    }

    // Per-contract by-id files for the bounded subset (top-N by amount +
    // every MP-tied contract). The SPA's /procurement/contract/:key fetches
    // these directly without re-walking month-shards.
    const byId = writeByIdContracts(
      PROCUREMENT_DIR,
      CONTRACTS_DIR,
      mpConnected,
    );
    console.log(
      `  by-id contracts: ${byId.emitted} file(s) ` +
        `(${byId.mpTied} MP-tied, ${byId.topByAmount} top-by-amount, ${byId.removed} pruned)`,
    );

    // Prefix-sharded detail store covering EVERY contract, so the faceted
    // browser (which deep-links every row) always resolves /contract/:key.
    const byIdShards = writeByIdShards(PROCUREMENT_DIR, CONTRACTS_DIR);
    console.log(
      `  by-id shards: ${byIdShards.contracts.toLocaleString()} contract(s) → ${byIdShards.shards} shard(s)`,
    );

    // Build the index summary. Aggregate totals across MP-connected
    // contractors for the at-a-glance "total awarded to MP-tied" figure.
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
    console.log(
      `  companies-index.json missing — skipping cross-reference. ` +
        `Run /update-connections to enable the journalism payload.`,
    );
  }

  // 7a. Slim feeds for the heavy SPA pages — top-N pre-selected from the
  // derived files so the /procurement/flags page (~1 MB otherwise) and the
  // /procurement/people scanner load a few KB. Read from disk; emit empty when
  // the underlying derived files are absent.
  const riskFeed = buildRiskFeed(DERIVED_DIR);
  writeRiskFeed(DERIVED_DIR, riskFeed);
  const concFull = buildConcentrationFull(DERIVED_DIR);
  writeConcentrationFull(DERIVED_DIR, concFull);
  const personIndex = buildPersonIndex(DERIVED_DIR);
  writePersonIndex(DERIVED_DIR, personIndex);
  console.log(
    `  risk_feed.json: ${riskFeed.topConcentration.length} conc + ${riskFeed.topMpTied.length} mp-tied; ` +
      `concentration_full.json: ${concFull.total} pair(s); ` +
      `person_procurement_index.json: ${personIndex.total} person(s)`,
  );

  // 7b. Per-settlement procurement rollup. Reads awarders/*.json (already
  // enriched with geo from buildRollups) + awarder_contracts/*.json and
  // emits by_settlement/{ekatte}.json + index.json + _national.json.
  // Drives the /procurement/by-settlement landing + per-settlement tiles
  // on the existing settlement detail pages. See
  // [[project_procurement_geo]] for the methodology note.
  console.log(`→ building per-settlement procurement shards`);
  const bs = await buildBySettlement();
  console.log(
    `  by_settlement/: ${bs.settlementFiles} settlement file(s); ` +
      `${bs.localAwardersPinned} local-tier buyer(s) pinned, ` +
      `${bs.nationalAwarders} aggregated into _national.json, ` +
      `${bs.awardersWithoutGeo} dropped (no cached address)`,
  );

  // 8. Index + bundles.
  writeIndexJson(
    previousBundles,
    CONTRACTS_DIR,
    rollups.totals,
    crossRefSummary,
    officialsCrossRefSummary,
  );
  writeBundlesIndex({
    fetchedAt: new Date().toISOString(),
    total: previousBundles.length,
    entries: previousBundles,
  });
  console.log(`✓ index.json + bundles.json updated`);

  // 7. Upload.
  if (args.upload) {
    console.log(`→ uploading data/procurement/ to bucket`);
    await uploadTextTree(PROCUREMENT_DIR, "procurement");
    await uploadText(INDEX_FILE, "procurement/index.json");
    console.log(`✓ uploaded`);
  }
};

// Scan all month-shards once to build the set of bundleUuid values whose
// rows are present on disk. This is the source of truth for "which bundles
// have actually been ingested" — bundles.json is just a discovery cache.
//
// Only walk year-pattern subdirs (YYYY/). The contracts/ tree also contains
// `by-id/<key>.json` files which are single Contract objects (not arrays),
// so a naïve walk would crash on them.
const collectIngestedBundleUuids = (contractsDir: string): Set<string> => {
  const out = new Set<string>();
  if (!fs.existsSync(contractsDir)) return out;
  for (const entry of fs.readdirSync(contractsDir)) {
    if (!/^\d{4}$/.test(entry)) continue;
    const yearDir = path.join(contractsDir, entry);
    if (!fs.statSync(yearDir).isDirectory()) continue;
    for (const file of fs.readdirSync(yearDir)) {
      if (!/^\d{4}-\d{2}\.json$/.test(file)) continue;
      const rows = JSON.parse(
        fs.readFileSync(path.join(yearDir, file), "utf8"),
      ) as Contract[];
      for (const r of rows) {
        if (r.bundleUuid) out.add(r.bundleUuid);
      }
    }
  }
  return out;
};

const mergeBundles = (
  previous: BundleEntry[],
  fresh: BundleEntry[],
): BundleEntry[] => {
  const byUuid = new Map<string, BundleEntry>();
  for (const b of previous) byUuid.set(b.datasetUuid, b);
  for (const b of fresh) byUuid.set(b.datasetUuid, b);
  return [...byUuid.values()].sort((a, b) =>
    a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0,
  );
};

const cli = command({
  name: "ingest",
  args: {
    since: option({
      type: optional(string),
      long: "since",
      description: "Only ingest bundles whose periodEnd is on/after YYYY-MM-DD",
    }),
    bundle: option({
      type: optional(string),
      long: "bundle",
      description: "Ingest exactly one bundle by dataset UUID",
    }),
    maxBundles: option({
      type: optional(string),
      long: "max-bundles",
      description: "Cap the number of new bundles processed in one run",
    }),
    refreshCache: flag({
      type: optional(boolean),
      long: "refresh-cache",
      description: "Re-download bundles even when a cached copy exists",
      defaultValue: () => false,
    }),
    upload: flag({
      type: optional(boolean),
      long: "upload",
      description: "Upload data/procurement/ to GCS bucket after ingest",
      defaultValue: () => false,
    }),
    dryRun: flag({
      type: optional(boolean),
      long: "dry-run",
      description: "Parse + validate but do not write files",
      defaultValue: () => false,
    }),
    skipCanary: flag({
      type: optional(boolean),
      long: "skip-canary",
      description:
        "Skip the canary regression check (only when intentionally updating the fixture)",
      defaultValue: () => false,
    }),
    renormalize: flag({
      type: optional(boolean),
      long: "renormalize",
      description:
        "Re-process every already-ingested bundle from cache (apply parser changes to existing rows) + rebuild",
      defaultValue: () => false,
    }),
  },
  handler: (args) =>
    main({
      since: args.since,
      bundle: args.bundle,
      maxBundles: args.maxBundles,
      refreshCache: !!args.refreshCache,
      upload: !!args.upload,
      dryRun: !!args.dryRun,
      skipCanary: !!args.skipCanary,
      renormalize: !!args.renormalize,
    }),
});

run(cli, process.argv.slice(2));
