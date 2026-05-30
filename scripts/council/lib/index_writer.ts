// Merges per-município scrape results back into data/council/index.json
// + writes per-resolution shards under data/council/{obshtina}/{year}/{id}.json
// + writes per-município "votes" shards under data/council/votes/{obshtina}.json
// for the heavy per-councillor named-vote blocks.
//
// The index preserves the existing scaffolding fields (`source`,
// `indexName`, `tags`) that the React hook reads, and adds:
//   - `resolutionsByObshtina[<key>]`: most-recent-N resolutions (default 200);
//     `tally.perCouncillor` is STRIPPED — that lives in the votes shard
//   - `meta[<key>]`: per-município lastIngest + counts
//
// Per-município votes shards carry the per-councillor breakdown keyed by
// resolution id, fetched lazily by the "How did they vote" MyArea tile
// only when the user lands on a município with named-vote data. Splitting
// them keeps the always-fetched index lean (was ~2 MB with all SOF +
// VTR per-councillor blocks inline → ~780 KB without).
//
// Per-resolution shards aren't read directly by the frontend yet — they're
// the durable history for backfills, summary regeneration, and audit
// trails. The index gives the UI its small page-level snapshot.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type {
  CouncilIndexFile,
  CouncilResolution,
  MuniScrapeResult,
} from "./types";

const DATA_DIR = join(process.cwd(), "data/council");
const INDEX_PATH = join(DATA_DIR, "index.json");
const VOTES_DIR = join(DATA_DIR, "votes");
// Per-município index-slot cap. Bumped from 50 → 200 on 2026-05-29
// after Sofia gained per-councillor data via --ocr: a single Sofia
// session now ships up to 77 records, and the 50 cap was hiding
// session 60's richer data behind session 61's metadata-only slot
// in the MyArea tile (sessions are date-disjoint, and date-desc
// sort buried the older-but-richer rows). 200 keeps the file under
// a few MB even with full per-councillor blocks; per-resolution
// shards on disk remain the durable source of truth.
const PER_MUNI_LIMIT = 200;

const readIndex = async (): Promise<CouncilIndexFile> => {
  const raw = await readFile(INDEX_PATH, "utf8");
  return JSON.parse(raw) as CouncilIndexFile;
};

// Distinct resolution ids that have a durable shard on disk for a município:
// data/council/{code}/{YYYY}/{id}.json. This shard tree — not the slim index
// slot — is the source of truth for the historical resolution total. The
// index slot is capped at PER_MUNI_LIMIT, so its length under-reports any
// município whose history exceeds the cap. Counting shards keeps
// meta.resolutionCount honest and, unlike a monotonic max(existing, …), still
// shrinks if resolutions (and their shards) are legitimately removed. Returns
// an empty set for a município with no shard directory yet.
const listDurableShardIds = async (
  obshtinaCode: string,
): Promise<Set<string>> => {
  const muniDir = join(DATA_DIR, obshtinaCode);
  const ids = new Set<string>();
  let years: Dirent[];
  try {
    years = await readdir(muniDir, { withFileTypes: true });
  } catch {
    return ids; // município has no shard directory yet
  }
  for (const year of years) {
    if (!year.isDirectory()) continue;
    let files: string[];
    try {
      files = await readdir(join(muniDir, year.name));
    } catch {
      continue;
    }
    for (const f of files) {
      if (f.endsWith(".json")) ids.add(f.slice(0, -".json".length));
    }
  }
  return ids;
};

// Per-município per-councillor shard. Keyed by resolution id so the
// frontend can join against the slim index. Only resolutions that
// actually carry a named-vote breakdown appear here.
type CouncilVotesShard = {
  obshtinaCode: string;
  name: string;
  lastIngest: string;
  /** id → per-councillor rows, sorted by name as emitted by the parser. */
  votesById: Record<
    string,
    NonNullable<CouncilResolution["tally"]>["perCouncillor"]
  >;
};

/** Strip `tally.perCouncillor` from a resolution for inclusion in the slim
 *  index. The full per-councillor data lives in the per-município votes
 *  shard + per-resolution shards instead. */
const stripPerCouncillor = (r: CouncilResolution): CouncilResolution => {
  if (!r.tally?.perCouncillor) return r;
  // Destructure-and-drop pattern: capturing perCouncillor into _ underscores
  // the discard so eslint's no-unused-vars doesn't fire on it.
  const { perCouncillor: _, ...rest } = r.tally;
  void _;
  return { ...r, tally: rest };
};

const writeIndex = async (idx: CouncilIndexFile): Promise<void> => {
  // Stable key order; readable formatting. The data/ bucket sync picks this
  // up byte-for-byte so consistent serialisation matters. Strip the heavy
  // perCouncillor arrays — they live in data/council/votes/<obshtina>.json.
  const slimResolutions: Record<string, CouncilResolution[]> = {};
  for (const [code, rows] of Object.entries(idx.resolutionsByObshtina)) {
    slimResolutions[code] = rows.map(stripPerCouncillor);
  }
  const ordered: CouncilIndexFile = {
    source: idx.source,
    indexName: idx.indexName,
    tags: idx.tags,
    resolutionsByObshtina: slimResolutions,
    meta: idx.meta,
    note: idx.note,
  };
  await writeFile(INDEX_PATH, JSON.stringify(ordered, null, 2) + "\n", "utf8");
};

const writeVotesShard = async (
  obshtinaCode: string,
  muniName: string,
  resolutions: CouncilResolution[],
): Promise<number> => {
  const votesById: CouncilVotesShard["votesById"] = {};
  let kept = 0;
  for (const r of resolutions) {
    const pc = r.tally?.perCouncillor;
    if (!pc || pc.length === 0) continue;
    votesById[r.id] = pc;
    kept++;
  }
  // Skip writing a shard for munis with zero named-vote data — keeps the
  // votes/ directory uncluttered until OCR or per-município work unlocks
  // the data.
  if (kept === 0) return 0;
  await mkdir(VOTES_DIR, { recursive: true });
  const shard: CouncilVotesShard = {
    obshtinaCode,
    name: muniName,
    lastIngest: new Date().toISOString(),
    votesById,
  };
  await writeFile(
    join(VOTES_DIR, `${obshtinaCode}.json`),
    JSON.stringify(shard, null, 2) + "\n",
    "utf8",
  );
  return kept;
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
  const capped = merged.slice(0, limit);
  idx.resolutionsByObshtina[result.obshtinaCode] = capped;

  // True historical total = distinct resolution ids in the durable shard tree
  // folded with this run's ids. Must NOT be `merged.length`: `merged` is built
  // from the already-capped index slot (`prev`), so on an incremental scrape
  // that adds nothing to a município with > PER_MUNI_LIMIT history it would
  // collapse to the cap and silently under-report. The shard tree is the
  // source of truth.
  const trueIds = await listDurableShardIds(result.obshtinaCode);
  for (const r of result.resolutions) trueIds.add(r.id);
  const resolutionCount = trueIds.size;

  idx.meta = idx.meta ?? {};
  idx.meta[result.obshtinaCode] = {
    name: muniName,
    lastIngest: new Date().toISOString(),
    protocolsIngested:
      (idx.meta[result.obshtinaCode]?.protocolsIngested ?? 0) +
      result.protocolsTouched,
    resolutionCount,
  };

  // Write the slim index first, then the votes shard for this município.
  // Votes shard sees the SAME capped rows that the index shows, so the
  // frontend's join is always consistent — no stale per-councillor data
  // hanging around for rows that aged out of the index window.
  await writeIndex(idx);
  await writeVotesShard(result.obshtinaCode, muniName, capped);

  if (!opts.skipShards) {
    for (const r of result.resolutions) {
      await writeResolutionShard(r, result.obshtinaCode);
    }
  }

  return { added, updated, total: resolutionCount };
};

/**
 * One-shot rebuilder for the slim index + all per-município votes shards
 * from whatever is currently in data/council/index.json (treated as the
 * unstripped truth). Used during the sharding rollout to regenerate the
 * on-disk shape without re-scraping; afterwards mergeMuniResult keeps the
 * two files in sync incrementally.
 */
export const rebuildShardsFromIndex = async (): Promise<{
  munis: number;
  shardsWritten: number;
  votesTotal: number;
}> => {
  const idx = await readIndex();
  let shardsWritten = 0;
  let votesTotal = 0;
  for (const [code, rows] of Object.entries(idx.resolutionsByObshtina)) {
    const muniName = idx.meta?.[code]?.name ?? code;
    const written = await writeVotesShard(code, muniName, rows);
    if (written > 0) {
      shardsWritten++;
      votesTotal += written;
    }
    // Resync meta.resolutionCount from the durable shard tree. The slim index
    // slot (`rows`) is capped at PER_MUNI_LIMIT and under-reports any município
    // whose history exceeds the cap; counting shards restores the true total.
    // Only patch existing meta entries — don't fabricate name/lastIngest here.
    if (idx.meta?.[code]) {
      idx.meta[code].resolutionCount = (await listDurableShardIds(code)).size;
    }
  }
  await writeIndex(idx);
  return {
    munis: Object.keys(idx.resolutionsByObshtina).length,
    shardsWritten,
    votesTotal,
  };
};
