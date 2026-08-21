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
import { evictSupersededEopTwins } from "./content_key";
import { evictStaleBaseKeys, type StalePair } from "./stale_base_keys";
import {
  assertUniqueKeys,
  checkDiffSize,
  countDomainFiles,
  dropSyntheticLegacyTwins,
  findHugeContracts,
  rawJson,
  rowSort,
  runCanary,
  validateContract,
  writeStableJson,
} from "./validate";
import { buildRollups, writeRollups } from "./rollups";
import {
  buildMpConnected,
  buildEikLinkageMap,
  writeMpConnected,
} from "./cross_reference";
import { mpLinkageAvailable } from "../lib/mp_linkage";
import { end } from "../db/lib/pg";
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
import { uploadText } from "../lib/upload";
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
  writeStableJson(BUNDLES_FILE, idx);
};

// Group rows by YYYY-MM and write/merge each month shard. Merging strategy:
// dedupe by the contract `key` — the disambiguated row identity (see
// contract_key.ts). The same row re-ingested from a later bundle (АОП sometimes
// republishes) hashes to the same key and replaces in place; genuinely distinct
// rows that once shared a base tuple now carry distinct keys and both survive.
const writeMonthShards = (
  rows: Contract[],
): {
  newFiles: number;
  modifiedFiles: number;
  eopEvicted: number;
  staleEvicted: StalePair[];
} => {
  if (rows.length === 0)
    return { newFiles: 0, modifiedFiles: 0, eopEvicted: 0, staleEvicted: [] };
  const byMonth = new Map<string, Contract[]>();
  for (const r of rows) {
    const month = r.date.slice(0, 7);
    const arr = byMonth.get(month) ?? [];
    arr.push(r);
    byMonth.set(month, arr);
  }
  let newFiles = 0;
  let modifiedFiles = 0;
  let eopEvicted = 0;
  const staleEvicted: StalePair[] = [];
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
    // EOP-twin eviction. OCDS is authoritative. The ЦАИС ЕОП flat feed runs
    // weeks ahead of АОП's OCDS export, so the gap-fill (ingest_eop.ts
    // --cross-source-dedup) can eagerly stand in an `eop-` row for a covered
    // buyer's recent contract. When the authoritative OCDS row for that same
    // contract finally lands here, its `key` differs (source-namespaced), so the
    // key merge above keeps BOTH — double-counting. `evictSupersededEopTwins`
    // drops the superseded EOP twin by content match against the arriving OCDS
    // rows, using the same key set as the gap-fill's forward dedup.
    //
    // Per-shard eviction is sufficient: a twin always co-shards with its arrival.
    // Sharding keys on `date`, which is the ЦАИС publication date in BOTH feeds
    // (OCDS `truncateDate(release.date)` == EOP `parseBgDate(publicationDate)` —
    // the OCDS bundle publishes weeks later but each release.date is still the
    // original notice date, not the export timestamp). Verified on the real
    // 2026-05-21…06-03 fortnight (straddles the month boundary): 1827/1827
    // matched twins fell in the same shard, 0 cross-month.
    const { kept: deduped, evicted } = evictSupersededEopTwins(
      [...byKey.values()],
      freshRows,
    );
    eopEvicted += evicted;
    // Drop synthetic legacy `-x` twins that duplicate a real row in the same
    // shard (see dropSyntheticLegacyTwins). Self-heals shards polluted by an
    // earlier ingest and prevents a re-introduced blank-document-id row from
    // double-counting against its real twin.
    const twinned = dropSyntheticLegacyTwins(deduped).rows;
    // Drop legacy rows still carrying a key from a SUPERSEDED formula. Same mechanism as the
    // `-x` guard above, one key-formula change later: `disambiguateContractKeys` re-keyed
    // colliding rows, this merge is keyed on `Contract.key`, so the old-keyed row matched
    // nothing on re-ingest and has been double-counting ever since. Self-heals here rather than
    // needing another bespoke one-shot. Pairs, not a count — see the log below.
    const stale = evictStaleBaseKeys(twinned, freshRows);
    // LOG BEFORE THE WRITE, not after writeMonthShards returns. `assertUniqueKeys` throws INSIDE
    // this loop, so a mid-loop throw would otherwise leave earlier shards already written with
    // rows deleted and the pair log never printed — deletion with no record, which is the exact
    // failure "pairs, never a count" exists to prevent.
    for (const p of stale.evicted)
      console.log(
        `   self-healed stale base key ${p.evicted.key} → ${p.survivor.key}  ` +
          `${p.evicted.ocid} ${p.evicted.contractId ?? "-"} ` +
          `€${(p.evicted.amountEur ?? 0).toFixed(2)}` +
          (p.conflicts.length ? `  [conflict: ${p.conflicts.join("; ")}]` : ""),
      );
    staleEvicted.push(...stale.evicted);
    const merged = stale.rows.sort(rowSort);
    assertUniqueKeys(merged, `${month}.json`);
    const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    // Month shards keep FULL-precision amountEur (rawJson), NOT the cents
    // rounding canonicalJson applies to rollups. The shards are the normalized
    // source rows; rounding them here would (a) rewrite every shard the first
    // time it runs after the rounding was added — churning ~685MB through the
    // bucket for no data change — and (b) make the ingest non-idempotent (a
    // re-run with unchanged rows would still diff). Rollups/derived round at
    // serialization for determinism; shards do not. See docs/plans/sql-migration-v1.md (Phase 2d).
    const next = rawJson(merged);
    if (next === prev) continue;
    fs.writeFileSync(file, next);
    if (prev == null) newFiles++;
    else modifiedFiles++;
  }
  return { newFiles, modifiedFiles, eopEvicted, staleEvicted };
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
  writeStableJson(INDEX_FILE, idx);
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
  // cases: (a) a partial prior run left rollups stale; (b) the MP↔company link set
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
  const { newFiles, modifiedFiles, eopEvicted, staleEvicted } =
    writeMonthShards(allRows);
  console.log(
    `→ wrote ${newFiles} new + ${modifiedFiles} modified month-shard(s)` +
      (eopEvicted > 0
        ? `; evicted ${eopEvicted} EOP twin(s) superseded by the arriving OCDS rows`
        : ""),
  );
  // Summary only — every pair was already named inside writeMonthShards, before its shard was
  // written. NOTE this ingest is the OCDS one and emits no `aop-legacy-` rows, so it fires only
  // on a shard whose month holds BOTH feeds. Measured 2026-08-05: 0 of 188 shards do, so on
  // today's corpus this is a guard against recurrence, NOT the thing that clears the backlog.
  // That is `ingest_legacy` (or the audit runner) — see docs/plans/procurement-same-feed-dedup-v1.md §5.2.
  if (staleEvicted.length) {
    const eur = staleEvicted.reduce(
      (s, p) => s + (p.evicted.amountEur ?? 0),
      0,
    );
    console.log(
      `→ self-healed ${staleEvicted.length} stale-base-key row(s), €${eur.toFixed(2)}`,
    );
  }

  // 5. Diff cap. Skipped on --renormalize: re-processing every bundle
  // intentionally rewrites a large share of the month-shards.
  if (!args.renormalize) {
    checkDiffSize(baselineFileCount, newFiles, modifiedFiles);
  }

  // 6. Rebuild rollups.
  console.log(`→ rebuilding contractor/awarder rollups`);
  const rollups = buildRollups(CONTRACTS_DIR);
  const { contractorFiles, awarderFiles, contractorPruned, awarderPruned } =
    writeRollups(PROCUREMENT_DIR, rollups);
  console.log(
    `  ${contractorFiles} contractor file(s) (${contractorPruned} stale pruned), ${awarderFiles} awarder file(s) (${awarderPruned} stale pruned)`,
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
  // ⚠️ It reads the SAME link set as the MP arm since 2026-08-21 — kind='official' rather
  // than kind='mp' — not the retired officials declarations tree. Its own soft skip inside
  // buildPepConnected is what keeps an unreachable database from aborting the ingest here,
  // after every shard has already been written.
  console.log(`→ building officials→procurement cross-reference`);
  const pepConnected = await buildPepConnected(CONTRACTORS_DIR);
  writePepConnected(DERIVED_DIR, pepConnected);
  console.log(
    `  pep_connected.json: ${pepConnected.total} pair(s), ${pepConnected.officialCount} official(s)`,
  );
  // Officials cross-reference summary for the index (full-corpus view). De-dup
  // by contractor EIK so a company tied to several officials counts its euro
  // total once. Reads the same link set at kind='official' (see above).
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

  // 7. Cross-reference against the MP↔company link set + top-contractors + flow.
  // The link set is optional in ONE direction only — an UNREACHABLE one (no Postgres, or
  // company_politicians never created) means a fresh clone, and the procurement corpus is
  // still useful on its own, just without the journalism payload. A link set that EXISTS and
  // is empty hard-fails instead; see buildEikLinkageMap.
  let crossRefSummary: ProcurementIndex["crossReference"] | undefined;
  if (await mpLinkageAvailable()) {
    console.log(
      `→ cross-referencing contractors against the MP↔company link set`,
    );
    const linkageMap = await buildEikLinkageMap();
    console.log(
      `  EIK linkage map: ${linkageMap.byEik.size} EIK(s) with at least one MP link`,
    );
    const mpConnected = buildMpConnected(CONTRACTORS_DIR, linkageMap);
    writeMpConnected(DERIVED_DIR, mpConnected);
    console.log(
      `  ${mpConnected.entries.length} MP↔contractor pair(s) emitted to derived/mp_connected.json`,
    );

    const top = buildTopContractors(CONTRACTORS_DIR, mpConnected);
    const flow = buildFlow(AWARDERS_DIR, mpConnected, pepConnected);
    const concentration = buildAwarderConcentration(AWARDERS_DIR);
    writeDerived(DERIVED_DIR, top, flow, concentration);
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
      `  company_politicians unreachable — skipping cross-reference. ` +
        `Run db:load:tr:pg to enable the journalism payload.`,
    );
  }

  // 7a. Slim feeds for the heavy SPA pages — top-N pre-selected from the
  // derived files so the /procurement/flags page (~1 MB otherwise) and the
  // combined search box's person index load a few KB. Read from disk; emit
  // empty when the underlying derived files are absent.
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
  // NOTE: the by_settlement/ shards are NOT written any more. /procurement/by-settlement
  // is served from Postgres (procurement_settlement_rank + procurement_geo_payloads, 119),
  // which is refreshed by db:load:procurement-scopes:pg — see [[project_procurement_geo]].

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

  // 7. Upload. The contract / awarder / contractor corpus serves from Postgres
  // (/api/db/*), NOT the static bucket — the local data/procurement/ tree exists
  // only as the PG-load source (load_pg / load_tr_pg read it). So we push ONLY
  // the few small blobs the SPA still fetches straight from the bucket (firebase
  // rewrites /procurement/*.json → GCS), never the whole ~3 GB tree.
  if (args.upload) {
    console.log(`→ uploading procurement serving blobs to bucket`);
    // (localPath, remoteSubpath, frontend consumer). index.json is NOT here —
    // nothing fetches /procurement/index.json from the bucket (the dashboard
    // index is PG-served); it stays a local-only artifact.
    const servingBlobs: Array<[string, string, string]> = [
      [
        path.join(PROCUREMENT_DIR, "roads.json"),
        "procurement/roads.json",
        "useRoadGeometry",
      ],
      [
        path.join(DERIVED_DIR, "mp_party.json"),
        "procurement/derived/mp_party.json",
        "useMpParty",
      ],
      [
        path.join(DERIVED_DIR, "hub_stats.json"),
        "procurement/derived/hub_stats.json",
        "useProcurementHubStats",
      ],
      [
        path.join(DERIVED_DIR, "sector_stats.json"),
        "procurement/derived/sector_stats.json",
        "useSectorStats",
      ],
    ];
    for (const [local, remote, consumer] of servingBlobs) {
      if (!fs.existsSync(local)) {
        console.warn(`  ⚠ ${remote} missing on disk (${consumer}) — skipped`);
        continue;
      }
      await uploadText(local, remote);
    }
    console.log(`✓ uploaded ${servingBlobs.length} serving blob(s)`);
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

// These builders now touch Postgres (the gated MP↔company link set), so the module-level
// pool must be closed or the process lingers on an idle socket after its work is done —
// the same `await end()` every scripts/db/load_*.ts finishes with.
run(cli, process.argv.slice(2)).finally(() => end());
