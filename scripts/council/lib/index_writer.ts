// Merges per-município scrape results back into data/council/index.json
// + writes per-resolution shards under data/council/{obshtina}/{year}/{id}.json.
//
// The index preserves the existing scaffolding fields (`source`,
// `indexName`, `tags`) that the React hook reads, and adds:
//   - `resolutionsByObshtina[<key>]`: most-recent-N resolutions (default 50)
//   - `meta[<key>]`: per-município lastIngest + counts
//
// Per-resolution shards aren't read directly by the frontend yet — they're
// the durable history for backfills, summary regeneration, and audit
// trails. The index gives the UI its small page-level snapshot.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CouncilIndexFile,
  CouncilResolution,
  MuniScrapeResult,
} from "./types";

const DATA_DIR = join(process.cwd(), "data/council");
const INDEX_PATH = join(DATA_DIR, "index.json");
const PER_MUNI_LIMIT = 50;

const readIndex = async (): Promise<CouncilIndexFile> => {
  const raw = await readFile(INDEX_PATH, "utf8");
  return JSON.parse(raw) as CouncilIndexFile;
};

const writeIndex = async (idx: CouncilIndexFile): Promise<void> => {
  // Stable key order; readable formatting. The data/ bucket sync picks this
  // up byte-for-byte so consistent serialisation matters.
  const ordered: CouncilIndexFile = {
    source: idx.source,
    indexName: idx.indexName,
    tags: idx.tags,
    resolutionsByObshtina: idx.resolutionsByObshtina,
    meta: idx.meta,
    note: idx.note,
  };
  await writeFile(INDEX_PATH, JSON.stringify(ordered, null, 2) + "\n", "utf8");
};

const sortByDateDesc = (a: CouncilResolution, b: CouncilResolution): number => {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const an = parseInt(a.number, 10) || 0;
  const bn = parseInt(b.number, 10) || 0;
  return bn - an;
};

const writeResolutionShard = async (
  r: CouncilResolution,
  obshtina: string,
): Promise<void> => {
  const year = r.date.slice(0, 4);
  const dir = join(DATA_DIR, obshtina, year);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${r.id}.json`),
    JSON.stringify(r, null, 2) + "\n",
    "utf8",
  );
};

export type MergeOptions = {
  /** Limit resolutions per município in the index. Defaults to 50. */
  perMuniLimit?: number;
  /** Skip per-resolution shard writes (faster dry runs). */
  skipShards?: boolean;
};

/**
 * Fold one município's scrape result into the global index + shards.
 * Existing resolutions for that município are merged (by id) with the
 * new ones — re-runs of the same protocol idempotently overwrite.
 */
export const mergeMuniResult = async (
  result: MuniScrapeResult,
  muniName: string,
  opts: MergeOptions = {},
): Promise<{ added: number; updated: number; total: number }> => {
  const limit = opts.perMuniLimit ?? PER_MUNI_LIMIT;
  const idx = await readIndex();
  const prev = idx.resolutionsByObshtina[result.obshtinaCode] ?? [];

  // Merge by id. New records overwrite previous ones with the same id.
  const byId = new Map<string, CouncilResolution>();
  for (const r of prev) byId.set(r.id, r);
  let added = 0;
  let updated = 0;
  for (const r of result.resolutions) {
    if (byId.has(r.id)) updated++;
    else added++;
    byId.set(r.id, r);
  }

  // Sort newest-first, cap to perMuniLimit for the index.
  const merged = Array.from(byId.values()).sort(sortByDateDesc);
  idx.resolutionsByObshtina[result.obshtinaCode] = merged.slice(0, limit);

  idx.meta = idx.meta ?? {};
  idx.meta[result.obshtinaCode] = {
    name: muniName,
    lastIngest: new Date().toISOString(),
    protocolsIngested:
      (idx.meta[result.obshtinaCode]?.protocolsIngested ?? 0) +
      result.protocolsTouched,
    resolutionCount: merged.length,
  };

  await writeIndex(idx);

  if (!opts.skipShards) {
    for (const r of result.resolutions) {
      await writeResolutionShard(r, result.obshtinaCode);
    }
  }

  return { added, updated, total: merged.length };
};
