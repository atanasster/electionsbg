// Gzip-upload the hot, large JSON files to the data bucket with
// `Content-Encoding: gzip` so GCS serves them compressed (decompressive
// transcoding). Run: `npm run bucket:gz` (or `npm run bucket:gz:dry`).
//
// WHY: the bucket (storage.googleapis.com/data-electionsbg-com) stores objects
// UNCOMPRESSED. `bucket:sync`'s `gsutil rsync -j json` flag is *transport*
// encoding — it compresses the upload only; the stored object is identity and is
// served uncompressed. Verified live:
//   x-goog-stored-content-encoding: identity ; content-length: 985281
// so every visitor downloads the full file. `gsutil cp -Z` stores the object
// gzipped + sets Content-Encoding, cutting candidates.json 985 KB -> ~150 KB
// (6.6x) and settlements.json 963 KB -> ~164 KB. Proven live on a throwaway key.
//
// SCOPE: this compresses the HOT large files the AI chat + main site wait on
// (resolution indexes, per-election summaries, search indexes, the roll-call day files and
// their aggregates) — a bounded set, re-uploaded every run. It does NOT compress the whole
// 9.9 GB tree (847k files); that needs replacing rsync with an incremental, gzip-aware
// uploader — a separate, operator-validated change. See README.
//
// COST, measured 2026-08-21 — read both numbers, they differ by ~18x. The run reads and
// gzips 402.9 MB across 765 files locally and UPLOADS 22.7 MB of that. The upload is the
// cheap half; the local pass and the rsync churn below are not. "~tens of MB" described
// only the upload and was read as the whole cost, so both are stated now. (Both figures
// grow as sittings land — re-read them from `npm run bucket:gz:dry`, don't trust this line.)
//
// CAVEAT (ordering): `bucket:sync` (rsync) re-uploads these files UNCOMPRESSED
// because the gzipped object differs from the local file, so it would clobber
// the gzip. RUN THIS AFTER `bucket:sync` (use `npm run bucket:sync:all`).

import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isExcluded } from "./bucket_sync_paths";

const BUCKET = "gs://data-electionsbg-com";
const CACHE_CONTROL = "public,max-age=300,must-revalidate";
const CONCURRENCY = 12;
const DATA = "data";
const DRY = process.argv.includes("--dry-run") || process.argv.includes("-n");

// Files present once at the data root (globals + cross-cutting indexes).
const GLOBAL_FILES = [
  "data_map.json",
  "settlements.json",
  "municipalities.json",
  "canonical_parties.json",
  "ekatte_index.json",
  "postcode_ekatte.json",
  "grao_population.json",
  "census_2021.json",
  "census_2021_settlements.json",
  "indicators.json",
  "macro.json",
  "regional.json",
  // parliament/index.json retired from the bucket (persons-pg-retirement-v1 T2.4): useMps + the
  // partyMps AI tool read mp_profile + mp_roster_meta via /api/db/mp-roster, so the roster is no
  // longer served or gzip-uploaded. It stays on disk as the loader source + for the build scripts.
  "parliament/connections.json",
  // parliament/connections-search.json retired from the bucket (site-hygiene-v1
  // T6b): no reader in src/, ai/, scripts/ or functions/. Removed from HERE as
  // well as from the rsync -x list, because `gsutil cp -Z` takes no -x — leaving
  // it would have defeated the exclusion entirely, and `bucket:sync:all` runs
  // bucket:gz AFTER the sync, so this path wins. Same removal the two
  // retirements commented above made.
  //
  // ⚠️ parliament/connections.json STAYS: it is a published dataset, offered for
  // download on /data in both languages (scripts/prerender/routes.ts).
  "parliament/votes/index.json",
  "parliament/votes/derived/search_index.json",
  // dissents.json was HERE until json-retirement-v2 Tier 2 retired it (served from 135 via
  // /api/db/mp-dissents). Removed in the same commit as its `isExcluded` entry: `gsutil cp -Z`
  // takes no -x and bucket:gz runs AFTER the sync, so a path left here re-publishes a retired
  // artifact — the trap the two retirements commented above record.
  //
  // ⚠️ similarity.json and loyalty.json STAY. Tier 2 moved the SITE off them, but both are
  // still fetched by ai/tools/parliament.ts and loyalty.json additionally by
  // src/data/myarea/useMpSignals.ts — the `ai/`-is-not-`src/` blind spot. They are still
  // served, so they are still worth compressing.
  //
  // ⚠️ topic_index.json STAYS. Tier 3b removed its two src/ fallback readers, which is what
  // an earlier version of this note said would release it — but ai/tools/parliament.ts still
  // fetches it and names it in `provenance` twice. Same ai/-is-not-src/ blind spot as
  // similarity.json above. Releasing it means moving those tools, not discharging this line.
  // Measured 2026-08-21 (zlib level 6, what `cp -Z` stores):
  //     similarity.json   12,275,762 -> 1,545,406  ( 7.9x)
  //     topic_index.json   8,368,917 ->   634,191  (13.2x)
  "parliament/votes/derived/similarity.json",
  "parliament/votes/derived/topic_index.json",
  // officials/municipal/search_index.json retired from the bucket (persons-pg-retirement-v1
  // T1.5): the header search reads municipal_officials_table via /api/db, so the file is no
  // longer served or gzip-uploaded. It stays on disk only for the offline search harness.
  // NOTE: procurement, funds AND prices are served from Cloud SQL (/api/db/*),
  // not GCS. The whole data/procurement/ tree (except roads.json +
  // derived/mp_party.json) and the whole data/funds/ tree are excluded from
  // bucket:sync and no longer gzip-uploaded here (funds/confirmed.json is now a
  // fund_payloads row). Same for data/prices/ since migration 048: every
  // dashboard payload lives in price_payloads and is served by
  // /api/db/price-payload, so prices/{index,dict,ranking,chains}.json were
  // dropped from this list. The two files still under data/prices/ —
  // product_slugs.json (prerender + sitemap) and product_overrides.json (an
  // input to rebuild_catalog) — are read from the local repo path at build
  // time, never fetched over HTTP, so they are not uploaded at all.
];

// Per-election files (one per ballot folder, YYYY_MM_DD[...]).
const PER_ELECTION_FILES = [
  "candidates.json",
  "national_summary.json",
  "region_votes.json",
  "sections_index.json",
];

const isElectionDir = (n: string): boolean => /^\d{4}_\d{2}_\d{2}/.test(n);

// Big local-election section shards: the multi-район city indexes (SOF ~2MB,
// Plovdiv ~0.8MB, Varna ~0.7MB) are fetched whole by their dashboards; gzip cuts
// them ~6× on the wire. Threshold skips the ~1,000 tiny per-município shards.
const SECTION_SHARD_GZIP_MIN = 120_000;

// NOTE: the heavy per-EIK procurement rollups (awarder_contracts / contractors
// / awarders), the by_ns slices and the derived/contract_index year shards used
// to be gzip-uploaded here. Procurement now serves from Cloud SQL (/api/db/*),
// so those trees are excluded from the bucket entirely — nothing to gzip.

const collect = (): string[] => {
  const out: string[] = [];
  for (const rel of GLOBAL_FILES) {
    if (existsSync(join(DATA, rel))) out.push(rel);
  }
  for (const entry of readdirSync(DATA, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isElectionDir(entry.name)) continue;
    for (const f of PER_ELECTION_FILES) {
      const rel = `${entry.name}/${f}`;
      if (existsSync(join(DATA, rel))) out.push(rel);
    }
    // Local cycles (YYYY_MM_DD_mi) carry per-município section shards under
    // sections/; gzip only the large ones.
    if (/_mi$/.test(entry.name)) {
      const secDir = join(DATA, entry.name, "sections");
      if (existsSync(secDir)) {
        for (const f of readdirSync(secDir)) {
          if (!f.endsWith(".json")) continue;
          const rel = `${entry.name}/sections/${f}`;
          if (statSync(join(DATA, rel)).size > SECTION_SHARD_GZIP_MIN)
            out.push(rel);
        }
      }
    }
  }
  // ⚠️ THE LAST GUARD, and the one this file shipped WITHOUT. `gsutil cp -Z` takes no -x, so
  // an exclusion in bucket_sync_paths.ts stops the rsync and nothing else — a retired path
  // left in GLOBAL_FILES (or reachable by one of the directory walks above) goes on being
  // republished, gzipped, looking healthy, with no symptom. That is the same "half a guard"
  // P1 fixed for uploadText(); this closes it for the gzip uploader, so a retirement lands in
  // ONE file and every uploader honours it. Reported rather than silently dropped: a path
  // that is BOTH listed here and excluded there is a contradiction someone should resolve.
  const kept: string[] = [];
  for (const rel of out) {
    const why = isExcluded(rel);
    if (why) console.warn(`  skip (excluded): ${rel} — ${why}`);
    else kept.push(rel);
  }
  return kept;
};

const uploadOne = (rel: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "gsutil",
      [
        "-h",
        `Cache-Control:${CACHE_CONTROL}`,
        "cp",
        "-Z", // gzip content-encoding (stored compressed + header set)
        join(DATA, rel),
        `${BUCKET}/${rel}`,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`gsutil exit ${code} (${rel})`)),
    );
  });

const mb = (n: number): string => (n / 1048576).toFixed(1);

const run = async (): Promise<void> => {
  const files = collect();
  let raw = 0;
  let gz = 0;
  for (const rel of files) {
    const buf = readFileSync(join(DATA, rel));
    raw += buf.length;
    // Default level (6), NOT level 9 — this line reports what `gsutil cp -Z` will actually
    // store and serve, and cp -Z uses zlib's default. At level 9 the printed figure
    // under-reported the stored size by ~7% on the session tree (8.4 MB vs 9.0 MB), i.e. it
    // flattered a number this file exists to state honestly.
    gz += gzipSync(buf).length;
  }
  console.log(
    `${DRY ? "[dry-run] " : ""}${files.length} hot files — ${mb(raw)} MB raw -> ${mb(gz)} MB gzipped (${((1 - gz / raw) * 100).toFixed(0)}% smaller on the wire)`,
  );
  if (DRY) {
    // 1 MB floor, not 100 KB: the set is ~765 files now that the session tree is in, and a
    // ~320-line listing buries the summary line above — which is the line an operator reads.
    const NAMED_MIN = 1_000_000;
    let unnamed = 0;
    for (const rel of files) {
      const sz = statSync(join(DATA, rel)).size;
      if (sz > NAMED_MIN) console.log(`  ${mb(sz).padStart(6)} MB  ${rel}`);
      else unnamed++;
    }
    if (unnamed) console.log(`  (+${unnamed} files under ${mb(NAMED_MIN)} MB)`);
    console.log(
      `[dry-run] would upload to ${BUCKET} with Content-Encoding: gzip. Re-run without --dry-run to upload.`,
    );
    return;
  }

  let done = 0;
  let failed = 0;
  const queue = [...files];
  const worker = async (): Promise<void> => {
    for (;;) {
      const rel = queue.shift();
      if (!rel) return;
      try {
        await uploadOne(rel);
      } catch (e) {
        failed += 1;
        console.error(`  ✗ ${rel}: ${(e as Error).message}`);
        continue;
      }
      done += 1;
      if (done % 25 === 0) console.log(`  ...${done}/${files.length}`);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker),
  );
  console.log(
    `uploaded ${done}/${files.length} gzipped${failed ? `, ${failed} failed` : ""}.`,
  );
  process.exit(failed ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
