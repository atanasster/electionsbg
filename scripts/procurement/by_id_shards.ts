// Prefix-sharded per-contract detail store — universal coverage for the
// /procurement/contract/:key page.
//
// The sibling by_id.ts emits one tiny file per row for a BOUNDED subset (top-N
// by amount + MP-tied), because an unconstrained one-file-per-row tree at ~300k
// rows is slow to rsync/walk. But the faceted contracts browser now deep-links
// EVERY row, so every key must resolve. The compromise: group rows into shards
// keyed by the first 3 hex chars of the contract key — 4096 buckets, ~70 rows
// each (~25 KB raw / ~10 KB gzipped). The detail hook loads the one prefix shard
// and picks the key out of it, so a single small fetch resolves any contract.
//
//   npx tsx scripts/procurement/by_id_shards.ts
//
// Output (gitignored, ship via bucket:sync):
//   contracts/by-id/shard/<3-hex-prefix>.json   { [key]: Contract }
//
// The single-file by_id.ts tree is kept as a fast path / fallback (the hot
// subset stays a ~600-byte fetch); useContract tries the shard first and falls
// back to the single file when the shard tree hasn't been synced yet.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Contract } from "./types";

// 3 hex chars → 4096 shards. Keys are sha256-derived 12-hex slugs, so the
// distribution across prefixes is uniform.
const PREFIX_LEN = 3;

export interface ByIdShardResult {
  shardDir: string;
  shards: number;
  contracts: number;
}

export const writeByIdShards = (
  procurementDir: string,
  contractsDir: string,
): ByIdShardResult => {
  const shardDir = path.join(procurementDir, "contracts", "by-id", "shard");
  // Rebuild from scratch so a row that's been removed upstream (dedup, re-ingest)
  // doesn't linger in a stale shard.
  fs.rmSync(shardDir, { recursive: true, force: true });
  fs.mkdirSync(shardDir, { recursive: true });

  // Group every contract by key prefix. Holds the corpus in memory once; at
  // ~300k rows this is a few hundred MB — comparable to the rollup builders.
  const buckets = new Map<string, Record<string, Contract>>();
  let contracts = 0;

  if (fs.existsSync(contractsDir)) {
    for (const year of fs.readdirSync(contractsDir)) {
      if (!/^\d{4}$/.test(year)) continue; // skip the sibling by-id/ tree
      const yearDir = path.join(contractsDir, year);
      if (!fs.statSync(yearDir).isDirectory()) continue;
      for (const file of fs.readdirSync(yearDir)) {
        if (!/^\d{4}-\d{2}\.json$/.test(file)) continue;
        const rows = JSON.parse(
          fs.readFileSync(path.join(yearDir, file), "utf8"),
        ) as Contract[];
        for (const r of rows) {
          if (!r.key) continue;
          const prefix = r.key.slice(0, PREFIX_LEN);
          let bucket = buckets.get(prefix);
          if (!bucket) {
            bucket = {};
            buckets.set(prefix, bucket);
          }
          // On the astronomically rare key collision, last write wins — same as
          // the single-file tree.
          bucket[r.key] = r;
          contracts++;
        }
      }
    }
  }

  for (const [prefix, bucket] of buckets) {
    // Compact (no pretty-print): these shards are gitignored, so there's no
    // diff-readability win to pay the ~40% indentation tax for — the detail
    // page just parses them.
    fs.writeFileSync(
      path.join(shardDir, `${prefix}.json`),
      JSON.stringify(bucket),
    );
  }

  return { shardDir, shards: buckets.size, contracts };
};

// Standalone entry point. Skipped when imported (ingest / rebuild_derived call
// writeByIdShards directly).
const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const PROCUREMENT_DIR = path.resolve(__dirname, "../../data/procurement");
  const CONTRACTS_DIR = path.join(PROCUREMENT_DIR, "contracts");
  const res = writeByIdShards(PROCUREMENT_DIR, CONTRACTS_DIR);
  console.log(
    `✓ by-id shards: ${res.contracts.toLocaleString()} contract(s) → ${res.shards} shard file(s) under ${path.relative(process.cwd(), res.shardDir)}/`,
  );
}
