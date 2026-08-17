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
//
// ⚠️ THE INDEX IS NOT A ROUND-TRIPPABLE STORE, and two rules here exist
// because it was treated as one until 2026-08-16:
//
//   1. `writeIndex` strips `tally.perCouncillor`. So anything read back OUT
//      of the index has already lost its named votes — `mergeMuniResult`
//      therefore builds its previous-state from the DURABLE SHARD TREE
//      (`readDurableResolutions`), never from the index slot. Reading the
//      index instead meant the votes shard could only ever hold what the
//      CURRENT scrape returned: measured 2026-08-16, 530 resolutions and
//      10,754 per-councillor rows existed on disk and were not served.
//   2. `writeVotesShard` MERGES into the shard on disk rather than replacing
//      it, so a scrape carrying named votes for three resolutions updates
//      three rows instead of replacing a hundred and seventy. Before this the
//      only thing preventing that wipe was the `kept === 0` early return —
//      i.e. the corpus was protected by the extraction being broken, and
//      fixing extraction alone would have destroyed it.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type {
  CouncilIndexFile,
  CouncilResolution,
  MuniScrapeResult,
} from "./types";

// Resolved PER CALL, not at module scope. Module-scope resolution froze the
// path at import time, which forced tests into a process.chdir +
// vi.resetModules dance — the only chdir in the repo's test suite, and one
// that dies outright under a `threads` pool. An env override also makes the
// module usable from a non-repo cwd.
const dataDir = (): string =>
  process.env.COUNCIL_DATA_DIR ?? join(process.cwd(), "data/council");
const indexPath = (): string => join(dataDir(), "index.json");
const votesDir = (): string => join(dataDir(), "votes");
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
  const raw = await readFile(indexPath(), "utf8");
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
const listDurableShardPaths = async (
  obshtinaCode: string,
): Promise<{ id: string; path: string }[]> => {
  const muniDir = join(dataDir(), obshtinaCode);
  const out: { id: string; path: string }[] = [];
  let years: Dirent[];
  try {
    years = await readdir(muniDir, { withFileTypes: true });
  } catch (err) {
    // ENOENT is a município with no shard directory yet. Anything else
    // (EACCES / EMFILE / EIO) must NOT masquerade as an empty history: the
    // merge would silently lose its recovery basis, and a repair run would
    // persist resolutionCount: 0 into the committed index and report success.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw err;
  }
  for (const year of years) {
    if (!year.isDirectory()) continue;
    let files: string[];
    try {
      files = await readdir(join(muniDir, year.name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      out.push({
        id: f.slice(0, -".json".length),
        path: join(muniDir, year.name, f),
      });
    }
  }
  return out;
};

/**
 * Every durable resolution for a município, UNSTRIPPED — the only read path
 * that still carries `tally.perCouncillor` for historical rows, and so the
 * only correct basis for a merge (see the header note).
 *
 * @returns the parsed rows and their ids from ONE directory walk. Empty for a
 * município with no shard directory yet.
 * @throws only on a non-ENOENT filesystem error; an individual shard that is
 * unparseable OR malformed is skipped with a warning, because one corrupt file
 * must not cost the município its whole history. Shape is checked rather than
 * `as`-cast: a shard containing `null` or an array parses fine and then throws
 * a TypeError downstream, producing exactly the outcome the skip prevents.
 */
const readDurableResolutions = async (
  obshtinaCode: string,
): Promise<{ ids: Set<string>; rows: CouncilResolution[] }> => {
  const entries = await listDurableShardPaths(obshtinaCode);
  const rows: CouncilResolution[] = [];
  const ids = new Set<string>();
  for (const { id, path } of entries) {
    ids.add(id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (err) {
      console.warn(
        `[council] skipping unreadable durable shard ${path}: ${String(err)}`,
      );
      continue;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      typeof (parsed as CouncilResolution).id !== "string" ||
      typeof (parsed as CouncilResolution).date !== "string"
    ) {
      console.warn(`[council] skipping malformed durable shard ${path}`);
      continue;
    }
    rows.push(parsed as CouncilResolution);
  }
  return { ids, rows };
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

/**
 * Never let a resolution WITHOUT named votes displace one that has them.
 *
 * Per-councillor extraction is opt-in (`--per-councillor`) and the daily path
 * does not pass it, while re-emitting an already-ingested resolution is
 * designed behaviour — the watermark is deliberately held below any protocol
 * that failed to download, the deferred ledger re-attempts, and `--since-date`
 * re-runs are documented. Without this, one flagless re-scrape overwrites the
 * durable shard with a vote-less version; since the durable tree is now the
 * merge basis, the repair basis and the Postgres loader's input, that is a
 * permanent loss with nothing red anywhere. Measured:
 * `rebuildShardsFromDurable` recovered 0 afterwards.
 */
const carryNamedVotes = (
  next: CouncilResolution,
  prev: CouncilResolution | undefined,
): CouncilResolution => {
  const prevPc = prev?.tally?.perCouncillor;
  if (!prevPc?.length || next.tally?.perCouncillor?.length) return next;
  return {
    ...next,
    tally: {
      ...(next.tally as NonNullable<CouncilResolution["tally"]>),
      perCouncillor: prevPc,
    },
  };
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
  await writeFile(indexPath(), JSON.stringify(ordered, null, 2) + "\n", "utf8");
};

/**
 * Read a município's votes shard.
 *
 * @returns the shard, or `null` when the município has none yet (ENOENT).
 * @throws if the file exists but cannot be read or parsed. "Absent" and
 * "unreadable" are different events, and collapsing the second into the first
 * turns the additive merge back into a REPLACE for that run — measured, a
 * shard truncated mid-write (the shape a SIGINT leaves, and `scrape.ts`
 * installs SIGINT/SIGTERM handlers) was silently rewritten from 20 entries to
 * 5. `scrape.ts` catches per-município, so throwing costs one município rather
 * than the run.
 */
const readVotesShard = async (
  obshtinaCode: string,
): Promise<CouncilVotesShard | null> => {
  const p = join(votesDir(), `${obshtinaCode}.json`);
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err; // EACCES / EIO — do NOT proceed as if the shard were empty
  }
  try {
    return JSON.parse(raw) as CouncilVotesShard;
  } catch (err) {
    throw new Error(
      `[council] ${p} exists but does not parse (${String(err)}). ` +
        `Refusing to rebuild it from the index window — run ` +
        `\`tsx scripts/council/rebuild_shards.ts\` to restore it from the durable tree.`,
    );
  }
};

/** Compare two votesById maps: key SET (order-insensitive) plus each
 *  resolution's value. Values go through JSON.stringify, which is
 *  order-SENSITIVE — deliberately, since councillor order is data. */
const votesChanged = (
  a: CouncilVotesShard["votesById"],
  b: CouncilVotesShard["votesById"],
): boolean => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return true;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return true;
  for (const k of ka) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return true;
  }
  return false;
};

/** Fraction of a município's named-vote resolutions that may disappear in one
 *  write before the guard trips. The merge below cannot shrink on its own, so
 *  this is a tripwire for a future regression rather than a routine check —
 *  it is the assertion that would have caught the 2026-05 loss. */
const VOTES_SHRINK_TOLERANCE = 0.05;

/** Absolute floor beneath which the percentage tolerance is meaningless. */
const VOTES_SHRINK_MIN_DROP = 2;

/**
 * Should a write that takes a município from `before` to `kept` named-vote
 * resolutions be refused?
 *
 * Exported for testing, and pure for a reason: with the additive merge in
 * place this can never fire through `mergeMuniResult` — the accumulator is
 * seeded from disk, so `kept >= before` always. It is a tripwire for the ONE
 * regression that matters (someone reverting the merge to a replace), and the
 * only way to exercise arming semantics is to call it directly. A test that
 * drove it through the public API would be asserting on unreachable code and
 * would pass against a broken guard.
 */
export const shouldRefuseShrink = (
  before: number,
  kept: number,
  allowShrink = false,
): boolean =>
  !allowShrink &&
  before - kept >= VOTES_SHRINK_MIN_DROP &&
  kept < Math.floor(before * (1 - VOTES_SHRINK_TOLERANCE));

/**
 * MERGE this run's named votes into the município's votes shard.
 *
 * Additive by resolution id: a scrape that carries per-councillor blocks for
 * three resolutions updates those three and leaves every other entry on disk
 * intact. `resolutions` therefore only ever needs to carry what changed.
 *
 * Returns the number of resolutions in the shard AFTER the merge (0 when the
 * município has no named-vote data at all and no shard was written).
 */
const writeVotesShard = async (
  obshtinaCode: string,
  muniName: string,
  resolutions: CouncilResolution[],
  opts: { allowShrink?: boolean } = {},
): Promise<number> => {
  const existing = await readVotesShard(obshtinaCode);
  // Armed from DISK, independently of the accumulator below. Counting the
  // accumulator instead made the guard a tautology (it is only ever added to)
  // AND self-disarming: the one regression it exists for — reverting the merge
  // to a replace — removes the spread and zeroes the baseline in the same
  // edit. Measured: with the baseline taken from the accumulator that
  // regression silently wrote 5 entries where 21 belonged; taken from disk, it
  // throws.
  const before = Object.keys(existing?.votesById ?? {}).length;
  const votesById: CouncilVotesShard["votesById"] = {
    ...(existing?.votesById ?? {}),
  };

  for (const r of resolutions) {
    const pc = r.tally?.perCouncillor;
    if (!pc || pc.length === 0) continue;
    votesById[r.id] = pc;
  }

  const kept = Object.keys(votesById).length;

  // Nothing on disk and nothing incoming — skip writing a shard entirely, so
  // the votes/ directory stays uncluttered for the munis still on
  // aggregate-only tallies. Note this is now a genuine "nothing to do", NOT
  // the corpus guard it used to be: with the merge above, an empty scrape can
  // no longer wipe a populated shard, so the early return no longer carries
  // that weight.
  if (kept === 0) return 0;

  // Refuse rather than publish a shrink. The absolute floor keeps the check
  // meaningful for a município early in its named-vote coverage: at
  // before <= 20 a bare 5% tolerance is inert for every loss short of total,
  // and total is already caught by `kept === 0` above.
  if (shouldRefuseShrink(before, kept, opts.allowShrink)) {
    throw new Error(
      `[council] refusing to shrink ${obshtinaCode} votes shard: ` +
        `${before} → ${kept} named-vote resolutions ` +
        `(>${VOTES_SHRINK_TOLERANCE * 100}% drop). ` +
        `Pass --allow-shrink (rebuild_shards.ts) or allowShrink to override.`,
    );
  }

  // Don't rewrite an unchanged shard. `lastIngest` is the only field a no-op
  // run would move, and moving it makes a frozen corpus look freshly ingested
  // — which is precisely how the 2026-05 freeze stayed invisible for two and a
  // half months while the file was re-committed every week. Leaving the file
  // untouched means its mtime and its stamp both mean what they say.
  if (
    existing &&
    existing.name === muniName &&
    !votesChanged(existing.votesById ?? {}, votesById)
  ) {
    return kept;
  }

  await mkdir(votesDir(), { recursive: true });
  const shard: CouncilVotesShard = {
    obshtinaCode,
    name: muniName,
    lastIngest: new Date().toISOString(),
    votesById,
  };
  await writeFile(
    join(votesDir(), `${obshtinaCode}.json`),
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
  const dir = join(dataDir(), obshtina, year);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${r.id}.json`),
    JSON.stringify(r, null, 2) + "\n",
    "utf8",
  );
};

export type MergeOptions = {
  /** Limit resolutions per município in the index. Defaults to PER_MUNI_LIMIT (200). */
  perMuniLimit?: number;
  /** Skip per-resolution shard writes (faster dry runs). */
  skipShards?: boolean;
  /** Allow the votes shard to lose entries. Escape hatch only — see
   *  VOTES_SHRINK_TOLERANCE. */
  allowShrink?: boolean;
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

  // Previous state, lowest-fidelity first so the better source wins:
  //
  //   1. the index slot — STRIPPED of perCouncillor, and capped, but it is the
  //      only record of a resolution whose durable shard was never written
  //      (an older --skip-shards run);
  //   2. the durable shard tree — unstripped and uncapped, so it restores the
  //      named votes the index cannot carry.
  //
  // Taking (1) alone is the defect this ordering exists to fix; taking (2)
  // alone would silently drop shard-less rows out of the index.
  const indexRows = idx.resolutionsByObshtina[result.obshtinaCode] ?? [];
  const durable = await readDurableResolutions(result.obshtinaCode);

  // Merge by id. New records overwrite previous ones with the same id.
  const byId = new Map<string, CouncilResolution>();
  for (const r of indexRows) byId.set(r.id, r);
  for (const r of durable.rows) byId.set(r.id, r);
  let added = 0;
  let updated = 0;
  // What this run persists to the durable tree — the CARRIED-FORWARD version,
  // not `result.resolutions`, so a flagless re-scrape cannot strip an existing
  // shard's named votes.
  const toPersist: CouncilResolution[] = [];
  for (const raw of result.resolutions) {
    const r = carryNamedVotes(raw, byId.get(raw.id));
    if (byId.has(r.id)) updated++;
    else added++;
    byId.set(r.id, r);
    toPersist.push(r);
  }

  // Sort newest-first, cap to perMuniLimit for the index.
  const merged = Array.from(byId.values()).sort(sortByDateDesc);
  const capped = merged.slice(0, limit);
  idx.resolutionsByObshtina[result.obshtinaCode] = capped;

  // True historical total = every distinct id this município is known by, i.e.
  // `byId` = index ∪ durable ∪ this scrape. It must NOT be `capped.length`,
  // which is truncated to PER_MUNI_LIMIT and would collapse to the cap on the
  // six municipalities with more history than that. Counting `byId` also
  // includes index-only rows that never got a durable shard — which a walk of
  // the shard tree misses, and which the merge above exists to preserve.
  const resolutionCount = byId.size;

  idx.meta = idx.meta ?? {};
  idx.meta[result.obshtinaCode] = {
    name: muniName,
    lastIngest: new Date().toISOString(),
    protocolsIngested:
      (idx.meta[result.obshtinaCode]?.protocolsIngested ?? 0) +
      result.protocolsTouched,
    resolutionCount,
  };

  // Write order is DURABILITY order: the durable tree is what everything else
  // is rebuilt FROM, so it lands first. Writing it last (as this did until
  // 2026-08-16) meant an interruption between writes left resolutions in the
  // index with no durable shard — re-creating, as a live failure mode, the
  // shard-less rows the merge above treats as a legacy artefact.
  //
  // The index goes LAST because it carries `meta.protocolsIngested`. A throw
  // from the votes shard's shrink guard is caught per-município by scrape.ts
  // and the watermark is correctly not advanced, so the retry re-runs the same
  // protocols; had the index already been written, that counter would be
  // incremented twice for one ingest.
  //
  // `capped` is deliberately what the shard sees, so the shard tracks the
  // window the frontend can actually join against. It is NOT a cap on the
  // shard's contents: the merge is additive, so a resolution that ages out of
  // the index window keeps its named votes on disk rather than being dropped.
  // (Everything beyond the window is in the durable tree regardless, which is
  // what the Postgres loader reads.)
  if (!opts.skipShards) {
    for (const r of toPersist) {
      await writeResolutionShard(r, result.obshtinaCode);
    }
  }
  await writeVotesShard(result.obshtinaCode, muniName, capped, {
    allowShrink: opts.allowShrink,
  });
  await writeIndex(idx);

  return { added, updated, total: resolutionCount };
};

/**
 * Rebuild every per-município votes shard from the DURABLE SHARD TREE, and
 * resync meta.resolutionCount.
 *
 * This used to rebuild from `data/council/index.json`, on the assumption that
 * the index was "the unstripped truth". That was true only during the original
 * sharding rollout: `writeIndex` strips `tally.perCouncillor`, so from the
 * first merge onwards the index carried none and this function was a silent
 * no-op — it recomputed `kept === 0` for every município and skipped every
 * write, while reporting success. Reading the durable tree makes it mean what
 * its name says, and makes it the repair tool for a shard that has fallen
 * behind (which is how the 2026-05 corpus is recovered).
 */
export const rebuildShardsFromDurable = async (
  opts: {
    allowShrink?: boolean;
  } = {},
): Promise<{
  munis: number;
  shardsWritten: number;
  /** Resolutions carrying a named-vote block (NOT per-councillor rows). */
  resolutionsWithVotes: number;
  /** Individual per-councillor vote rows — ~25x the figure above. */
  voteRows: number;
}> => {
  const idx = await readIndex();
  const before = JSON.stringify(idx);
  let shardsWritten = 0;
  let resolutionsWithVotes = 0;
  let voteRows = 0;

  // Drive the loop from the union of the index's municipalities and the
  // directories actually on disk. Iterating the index alone would let the tool
  // whose job is to find data the index cannot see be blinded by the index —
  // the exact assumption this file was changed to remove.
  const codes = new Set(Object.keys(idx.resolutionsByObshtina));
  for (const e of await readdir(dataDir(), { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== "votes") codes.add(e.name);
  }

  for (const code of [...codes].sort()) {
    const muniName = idx.meta?.[code]?.name ?? code;
    const durable = await readDurableResolutions(code);
    const written = await writeVotesShard(code, muniName, durable.rows, {
      allowShrink: opts.allowShrink,
    });
    if (written > 0) {
      shardsWritten++;
      resolutionsWithVotes += written;
      for (const r of durable.rows) {
        voteRows += r.tally?.perCouncillor?.length ?? 0;
      }
    }
    // Resync meta.resolutionCount from the durable shard tree. The slim index
    // slot is capped at PER_MUNI_LIMIT and under-reports any município whose
    // history exceeds the cap; counting shards restores the true total.
    // Only patch existing meta entries — don't fabricate name/lastIngest here.
    if (idx.meta?.[code]) {
      idx.meta[code].resolutionCount = durable.ids.size;
    }
  }

  // Don't dirty the committed index on a no-op repair. Same reasoning as the
  // votes shard's own equality short-circuit: a moved mtime on an unchanged
  // corpus is the signal that hid the 2026-05 freeze.
  if (JSON.stringify(idx) !== before) await writeIndex(idx);

  return { munis: codes.size, shardsWritten, resolutionsWithVotes, voteRows };
};
