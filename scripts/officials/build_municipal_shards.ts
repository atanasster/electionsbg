// Emit per-obshtina roster shards from the in-memory entries or from the
// already-written data/officials/municipal/index.json.
//
// Why a standalone module:
//   - The full ingest in ./municipal.ts re-uses this to write shards in the
//     same step that writes index.json — no duplicated sort/group code.
//   - Operators who fix a typo in scripts/officials/_aliases.json can re-emit
//     just the shards (a few seconds) without re-scraping the whole register
//     (30-50 min cold). That's the standalone CLI path below.
//
// CLI:
//   tsx scripts/officials/build_municipal_shards.ts          # rebuild from index.json
//   tsx scripts/officials/build_municipal_shards.ts --dry-run # report stats, no writes

import fs from "fs";
import path from "path";
import { boolean, command, flag, run } from "cmd-ts";
import type {
  MunicipalIndexEntry,
  MunicipalIndexFile,
  MunicipalOfficialRole,
  MunicipalityRosterFile,
} from "../../src/data/dataTypes";
import { ROOT, writeJson } from "./shared";
import { buildResolver } from "./municipality_join";

const OUT_DIR = path.join(ROOT, "data", "officials", "municipal");
const SHARD_DIR = path.join(OUT_DIR, "by_obshtina");
const INDEX_PATH = path.join(OUT_DIR, "index.json");

// Per-shard size ceiling, raw bytes. Plovdiv (aggregates 6 districts into
// PDV22) tops out at ~36 KB / 5.5 KB gz, Varna at ~33 KB / 5.1 KB gz, Sofia
// city-wide at ~27 KB / 4.3 KB gz; p50 across all 288 shards is ~7 KB /
// ~1.5 KB gz. The 40 KB raw threshold is the "we've gained a new big city
// in the registry" signal — if a shard grows past it, reconsider lazy-
// loading the councillor tail vs. eagerly shipping the whole roster.
const SHARD_SIZE_WARN = 40_000;

// Roster display order: mayor → deputies → council chair → chief architect →
// councillors alpha. Pre-sorted at build time so the SPA can `.slice(0, N)`
// without re-sorting.
const ROLE_PRIORITY: Record<MunicipalOfficialRole, number> = {
  mayor: 0,
  deputy_mayor: 1,
  council_chair: 2,
  chief_architect: 3,
  councillor: 4,
  other: 5,
};
const rosterSort = (a: MunicipalIndexEntry, b: MunicipalIndexEntry): number => {
  const pa = ROLE_PRIORITY[a.role];
  const pb = ROLE_PRIORITY[b.role];
  if (pa !== pb) return pa - pb;
  return a.name.localeCompare(b.name, "bg");
};

export type ShardEmitResult = {
  shardsWritten: number;
  unmatched: MunicipalIndexEntry[];
  maxShardBytes: number;
};

/** Group entries by resolved obshtina code and write one shard per bucket.
 *  Callers receive the unmatched list so they can decide between throw and
 *  warn — the full ingest throws above a small threshold, the standalone
 *  CLI just reports.
 *
 *  `dryRun` skips disk writes. `entries` is the pre-sorted roster from the
 *  ingest, or the entries field of an existing index.json. */
export const emitShards = (
  entries: MunicipalIndexEntry[],
  meta: { generatedAt: string; years: number[] },
  options: { dryRun?: boolean; shardDir?: string } = {},
): ShardEmitResult => {
  // shardDir defaults to the real by_obshtina tree; the slug-normalisation
  // migration passes the isolated copy it is rewriting so a test/override apply
  // never touches production shards.
  const { dryRun = false, shardDir = SHARD_DIR } = options;
  const resolve = buildResolver();
  const buckets = new Map<
    string,
    { entries: MunicipalIndexEntry[]; registryName: string }
  >();
  const unmatched: MunicipalIndexEntry[] = [];
  for (const e of entries) {
    const m = resolve(e.municipality);
    if (!m) {
      unmatched.push(e);
      continue;
    }
    const tagged: MunicipalIndexEntry = m.isDistrict
      ? { ...e, district: m.district ?? e.municipality }
      : e;
    const bucket = buckets.get(m.code);
    if (bucket) {
      bucket.entries.push(tagged);
    } else {
      buckets.set(m.code, {
        entries: [tagged],
        registryName: e.municipality,
      });
    }
  }

  let shardsWritten = 0;
  let maxShardBytes = 0;
  for (const [code, bucket] of buckets.entries()) {
    const sorted = bucket.entries.sort(rosterSort);
    const shardByRole: Record<MunicipalOfficialRole, number> = {
      mayor: 0,
      deputy_mayor: 0,
      council_chair: 0,
      councillor: 0,
      chief_architect: 0,
      other: 0,
    };
    for (const e of sorted) shardByRole[e.role]++;
    const shard: MunicipalityRosterFile = {
      obshtina: code,
      registryName: bucket.registryName,
      generatedAt: meta.generatedAt,
      years: meta.years,
      byRole: shardByRole,
      entries: sorted,
    };
    const serialized = JSON.stringify(shard);
    const size = Buffer.byteLength(serialized, "utf-8");
    if (size > maxShardBytes) maxShardBytes = size;
    if (size > SHARD_SIZE_WARN) {
      console.warn(
        `  ⚠ shard ${code} is ${size} bytes (> ${SHARD_SIZE_WARN}) — consider splitting`,
      );
    }
    if (!dryRun) {
      writeJson(path.join(shardDir, `${code}.json`), shard);
      shardsWritten++;
    }
  }
  return { shardsWritten, unmatched, maxShardBytes };
};

const cmd = command({
  name: "build-municipal-shards",
  description:
    "Rebuild data/officials/municipal/by_obshtina/{code}.json from the current index.json. Skips the upstream scrape — use after editing scripts/officials/_aliases.json or after a typo fix that doesn't need a fresh ingest.",
  args: {
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      description: "Report stats and unmatched entries without writing shards.",
    }),
  },
  handler: async ({ dryRun }) => {
    if (!fs.existsSync(INDEX_PATH)) {
      console.error(
        `index.json missing at ${INDEX_PATH}. Run scripts/officials/municipal.ts first.`,
      );
      process.exit(1);
    }
    const index: MunicipalIndexFile = JSON.parse(
      fs.readFileSync(INDEX_PATH, "utf-8"),
    );
    const result = emitShards(
      index.entries,
      { generatedAt: index.generatedAt, years: index.years },
      { dryRun },
    );
    console.log(
      `${dryRun ? "[dry-run] " : ""}shards: ${result.shardsWritten}, ` +
        `unmatched: ${result.unmatched.length}, ` +
        `max bytes: ${result.maxShardBytes}`,
    );
    if (result.unmatched.length > 0) {
      console.log(
        "unmatched (add to scripts/officials/_aliases.json):",
        [...new Set(result.unmatched.map((u) => u.municipality))].sort((a, b) =>
          a.localeCompare(b, "bg"),
        ),
      );
    }
  },
});

// Guard so this file can also be imported as a library by ./municipal.ts.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return (
    entry.endsWith("build_municipal_shards.ts") ||
    entry.endsWith("build_municipal_shards.js")
  );
})();
if (invokedDirectly) {
  run(cmd, process.argv.slice(2));
}
