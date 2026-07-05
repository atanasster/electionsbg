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
// (resolution indexes, per-election summaries, search indexes) — a bounded set,
// re-uploaded every run (cheap, ~tens of MB). It does NOT compress the whole
// 9.9 GB tree (847k files); that needs replacing rsync with an incremental,
// gzip-aware uploader — a separate, operator-validated change. See README.
//
// CAVEAT (ordering): `bucket:sync` (rsync) re-uploads these files UNCOMPRESSED
// because the gzipped object differs from the local file, so it would clobber
// the gzip. RUN THIS AFTER `bucket:sync` (use `npm run bucket:sync:all`).

import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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
  "parliament/index.json",
  "parliament/connections.json",
  "parliament/connections-search.json",
  "parliament/votes/index.json",
  "parliament/votes/derived/search_index.json",
  "officials/municipal/search_index.json",
  "prices/index.json",
  "prices/dict.json",
  "prices/ranking.json",
  "prices/chains.json",
  // Funds: the curated journalism cross-reference. A single global file
  // fetched (once per session) by every /company/:eik view to test the EIK
  // against the ~10 curated cases — gzip cuts it ~6× on that first fetch.
  "funds/confirmed.json",
  // NOTE: procurement is served from Cloud SQL (/api/db/*), not GCS. The whole
  // data/procurement/ tree (except roads.json + derived/mp_party.json) is
  // excluded from bucket:sync and no longer gzip-uploaded here.
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
  return out;
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
    gz += gzipSync(buf, { level: 9 }).length;
  }
  console.log(
    `${DRY ? "[dry-run] " : ""}${files.length} hot files — ${mb(raw)} MB raw -> ${mb(gz)} MB gzipped (${((1 - gz / raw) * 100).toFixed(0)}% smaller on the wire)`,
  );
  if (DRY) {
    for (const rel of files) {
      const sz = statSync(join(DATA, rel)).size;
      if (sz > 100_000) console.log(`  ${mb(sz).padStart(6)} MB  ${rel}`);
    }
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
