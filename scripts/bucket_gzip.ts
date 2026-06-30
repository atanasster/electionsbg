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
  // Procurement landing page: the flow sankey (preview + full) and the
  // top-contractors table are the heavy files the /procurement page waits on.
  "procurement/index.json",
  "procurement/derived/flow.json",
  "procurement/derived/flow_full.json",
  "procurement/derived/top_contractors.json",
  // The concentration explorer (?pscope=all) waits on this 1.1 MB table.
  "procurement/derived/concentration_full.json",
  // The procurement dashboard's company-search box: slim {eik,name} index of
  // all ~26k contractors (1.8 MB raw), fetched once on first focus. Gzips ~4×.
  "procurement/derived/contractors_search.json",
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

// Heavy per-EIK procurement rollups. The full per-EIK tree is ~95k files (too
// many to gzip wholesale — see the SCOPE note above), but the big ones are the
// files the /company/:eik, /awarder/:eik and /company/:eik/contracts pages
// fetch whole, and they're highly repetitive JSON (repeated names/EIKs/dates)
// that gzips ~6-8×. The per-dir threshold skips the tiny long-tail (a ~4 KB
// rollup isn't worth a gsutil cp) so the upload stays bounded (~1.8k files).
const PER_EIK_DIRS: Array<{ dir: string; min: number }> = [
  // /company/:eik/contracts + /awarder/:eik — the biggest payloads (up to ~740 KB).
  { dir: "procurement/awarder_contracts", min: 50_000 },
  // /company/:eik core rollup (also reused by its top-contracts tile).
  { dir: "procurement/contractors", min: 20_000 },
  // /awarder/:eik core rollup + the /company/:eik display-name fallback fetch.
  { dir: "procurement/awarders", min: 20_000 },
];

const collect = (): string[] => {
  const out: string[] = [];
  for (const rel of GLOBAL_FILES) {
    if (existsSync(join(DATA, rel))) out.push(rel);
  }
  // Per-election procurement slices: the /procurement landing fetches one
  // by_ns/<election>.json on load. Small (~25 KB each) but ~6× on the wire.
  const byNsDir = join(DATA, "procurement", "by_ns");
  if (existsSync(byNsDir)) {
    for (const f of readdirSync(byNsDir)) {
      if (f.endsWith(".json")) out.push(`procurement/by_ns/${f}`);
    }
    // Per-NS sidecars: the flows / people / concentration / flags pages each
    // wait on one of these when the section scope is a parliament (?pscope
    // defaults to the selected NS). Compress ~6× on the wire.
    for (const sub of [
      "flow",
      "people",
      "concentration",
      "risk_feed",
      "by_settlement",
    ]) {
      const subDir = join(byNsDir, sub);
      if (existsSync(subDir)) {
        for (const f of readdirSync(subDir)) {
          if (f.endsWith(".json")) out.push(`procurement/by_ns/${sub}/${f}`);
        }
      }
    }
  }
  // Contracts browser: each year shard is fetched whole on year-select and runs
  // 5.7–14.5 MB of highly repetitive JSON (repeated names/EIKs/dates) — gzip
  // cuts them ~8× on the wire, the single biggest procurement payload win.
  const ciDir = join(DATA, "procurement", "derived", "contract_index");
  if (existsSync(ciDir)) {
    for (const f of readdirSync(ciDir)) {
      if (f.endsWith(".json"))
        out.push(`procurement/derived/contract_index/${f}`);
    }
  }
  // Heavy per-EIK rollups (see PER_EIK_DIRS) — threshold-gated so the upload
  // stays bounded instead of touching the full ~95k-file per-EIK tree.
  for (const { dir, min } of PER_EIK_DIRS) {
    const abs = join(DATA, dir);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (!f.endsWith(".json")) continue;
      const rel = `${dir}/${f}`;
      if (statSync(join(DATA, rel)).size > min) out.push(rel);
    }
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
