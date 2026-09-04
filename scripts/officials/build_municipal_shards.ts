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
// ⚠️ A REAL RUN REWRITES EVERY SHARD TWICE — once from index.json, then again
// through decorateCandidateLinks(). That is not incidental: index.json carries
// no `candidateLink`, so the emit STRIPS the party / ballot-position /
// preference-vote / MP-photo enrichment from all ~289 shards and the decorate
// pass is the only thing that restores it. Measured 2026-09-04, before the two
// were chained: one bare re-emit deleted 5,331 links across 276 shards, whose
// only visible symptom is council tiles falling back to grey initials.
// ./municipal.ts has chained the same pair since it learned this; the CLI did
// not, so the cheap "just re-emit the shards" path was the lossy one.
//
// So the blast radius of this command is every shard, not the ones whose
// bucket changed — dry-run first if that matters.
//
// CLI:
//   tsx scripts/officials/build_municipal_shards.ts          # re-emit + re-decorate
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
// Imported from ./candidate_links (the library) rather than ./decorate_candidate_links (the
// CLI wrapper) — the latter calls `run(...)` at module scope, so importing it would fire its
// own argument parser against THIS command's argv.
import { decorateCandidateLinks, assertCanDecorate } from "./candidate_links";
import { countRoles } from "./role_reconcile";

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

/** The sitting bench — the officials the NEWEST register listing still names.
 *
 *  The roster index ACCUMULATES (see the note in ./municipal.ts), because
 *  `official_roster`, the council-vote join and the header search index all need
 *  every official who ever served. The shards are the one consumer that must
 *  not: they answer "who represents me now" on the my-area and governance
 *  tiles, and a councillor who left last year rendered beside the sitting ones
 *  is simply wrong.
 *
 *  Keyed on `descriptorYear` — the register folder a run last saw the official
 *  in — NOT on `latestDeclarationYear`, which is parsed out of the filing and
 *  lags it (a 2026 listing carries annuals declaring FY2025).
 *
 *  A file written before the roster accumulated has no `descriptorYear` on any
 *  entry and no `current` block; it WAS a single-year snapshot, so every entry
 *  is the bench and this returns all of them rather than nothing. */
export const currentBench = (
  index: MunicipalIndexFile,
): { year: number; entries: MunicipalIndexEntry[] } => {
  const year = index.current?.year ?? index.years[index.years.length - 1] ?? 0;
  const dated = index.entries.filter((e) => e.descriptorYear != null);
  if (dated.length === 0) return { year, entries: index.entries };
  return {
    year,
    entries: index.entries.filter((e) => e.descriptorYear === year),
  };
};

export type ShardEmitResult = {
  /** Shards this run produced — counted on a dry run too, where none are written. */
  shardsWritten: number;
  unmatched: MunicipalIndexEntry[];
  maxShardBytes: number;
  /** Shard files present in `shardDir` that this run did NOT produce. A município that
   *  stopped resolving, whose stale file is still being served. Never empty-by-construction:
   *  the emit does not delete. */
  stale: string[];
};

/** Group entries by resolved obshtina code and write one shard per bucket.
 *
 *  Callers receive `unmatched` AND `stale` so they can decide how loudly to fail: the full
 *  ingest tolerates up to 10 unmatched (it absorbs scrape flakiness), the standalone CLI
 *  tolerates none (its input is an already-parsed index.json). Neither may ignore them —
 *  an unmatched entry is an official missing from the tree, and a stale shard is a
 *  município still being served its pre-refusal roster.
 *
 *  ⚠️ THIS STRIPS `candidateLink` FROM EVERY SHARD IT WRITES. The field is joined onto the
 *  shards afterwards by candidate_links.ts and does not exist in index.json, so a caller
 *  must chain `decorateCandidateLinks()` — both callers do, and one bare re-emit measured
 *  2026-09-04 deleted 5,331 links across 276 shards.
 *
 *  `dryRun` skips disk writes (but still counts and still detects stale files). `entries` is
 *  the pre-sorted roster from the ingest, or the entries field of an existing index.json. */
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
    const shardByRole = countRoles(sorted);
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
    if (!dryRun) writeJson(path.join(shardDir, `${code}.json`), shard);
    // Counted either way. Inside the `if`, a dry run reported `shards: 0` while a real run
    // wrote 289 — telling an operator the opposite of the blast radius, on the command that
    // exists to preview it. The `[dry-run]` prefix already carries the distinction.
    shardsWritten++;
  }

  // ⚠️ THE EMIT IS ADDITIVE, so a shard is authoritative only while its município keeps
  // resolving. Nothing here unlinks: before rule 4 could refuse, that was harmless because
  // every name resolved; now a município that stops resolving keeps its PREVIOUS shard on
  // disk, and every consumer keeps fetching the pre-refusal answer at a 200. The chained
  // decorate pass makes it worse — it walks every *.json in the directory, so an orphan is
  // rewritten with a fresh mtime and looks maintained exactly when it is stale.
  //
  // Reported, never deleted: an orphan may equally be a município this run failed to
  // resolve, and unlinking on a bad run destroys the only copy. The caller decides.
  const expected = new Set([...buckets.keys()].map((c) => `${c}.json`));
  const stale = fs.existsSync(shardDir)
    ? fs
        .readdirSync(shardDir)
        .filter((f) => f.endsWith(".json") && !expected.has(f))
        .sort()
    : [];

  return { shardsWritten, unmatched, maxShardBytes, stale };
};

const cmd = command({
  name: "build-municipal-shards",
  description:
    "Rebuild data/officials/municipal/by_obshtina/{code}.json from the current index.json, then re-apply the candidateLink enrichment the rebuild strips (every shard is rewritten, not just the ones that changed). Skips the upstream scrape — use after editing scripts/officials/_aliases.json or after a typo fix that doesn't need a fresh ingest. Fails on an unresolved roster entry or an orphaned shard rather than exiting 0.",
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
    // ⚠️ BEFORE THE EMIT, NOT AFTER. `emitShards` strips candidateLink from every shard and
    // the decorate pass below is the only thing that puts it back, so a decorator that
    // cannot run must stop the write rather than follow it.
    if (!dryRun) assertCanDecorate();

    const bench = currentBench(index);
    const result = emitShards(
      bench.entries,
      { generatedAt: index.generatedAt, years: [bench.year] },
      { dryRun },
    );
    if (bench.entries.length !== index.entries.length) {
      console.log(
        `bench: ${bench.entries.length} sitting official(s) for ${bench.year}; ` +
          `${index.entries.length - bench.entries.length} retained from earlier year(s), not sharded`,
      );
    }
    console.log(
      `${dryRun ? "[dry-run] " : ""}shards: ${result.shardsWritten}, ` +
        `unmatched: ${result.unmatched.length}, ` +
        `max bytes: ${result.maxShardBytes}`,
    );
    if (result.stale.length > 0) {
      console.error(
        `${result.stale.length} shard file(s) this run did not produce — a município that ` +
          "stopped resolving, still being served from its pre-refusal shard: " +
          result.stale.join(", "),
      );
    }
    if (result.unmatched.length > 0) {
      console.error(
        "unmatched (add to scripts/officials/_aliases.json):",
        [...new Set(result.unmatched.map((u) => u.municipality))].sort((a, b) =>
          a.localeCompare(b, "bg"),
        ),
      );
    }

    // ⚠️ THROW ON ANY UNMATCHED ENTRY — a stricter threshold than municipal.ts:445, which
    // tolerates 10. That file absorbs scrape flakiness; this one takes an already-parsed
    // index.json, so an unmatched entry is a resolution failure with nothing to absorb, and
    // an official silently absent from the shard tree is exactly what T1 exists to end.
    //
    // Exiting 0 here would also invalidate municipality_join.ts's stated reason for refusing
    // rather than guessing ("both callers escalate it"), on the path this command now owns.
    if (!dryRun && (result.unmatched.length > 0 || result.stale.length > 0)) {
      throw new Error(
        `${result.unmatched.length} unresolved roster entr(ies) and ${result.stale.length} ` +
          "orphaned shard(s) — pin names in scripts/officials/_aliases.json, and run " +
          "`npx tsx scripts/officials/municipality_join.ts --dry-run` for the diagnosis",
      );
    }

    // ⚠️ A SHARD WRITE DESTROYS THE candidateLink ENRICHMENT, SO IT MUST BE RE-APPLIED HERE.
    // `emitShards` writes each bucket from index.json alone, and index.json does not carry
    // `candidateLink` — the party, ballot position, preference votes and MP photo are joined
    // onto the SHARDS afterwards, by ./candidate_links.ts. So a plain re-emit silently drops
    // every one of them.
    //
    // ./municipal.ts already knew this and chains `decorateCandidateLinks()` right after its
    // own emit, with a comment recording that skipping it once deleted 5,317 links across 276
    // of 288 shards, visible only as council tiles falling back to grey initials. This CLI —
    // advertised at the top of this file as the cheap "re-emit just the shards" path for an
    // operator who edited _aliases.json — did not, so it reproduced that exact loss: measured
    // 2026-09-04, one run took out 5,331 links across 276 shards.
    //
    // Chaining it here rather than documenting "remember to run decorate afterwards" is the
    // point: the two writers of these files must not be able to disagree about what a
    // complete shard contains, and a step an operator has to remember is a step that fails.
    if (!dryRun) {
      try {
        decorateCandidateLinks();
      } catch (err) {
        // The shards are ALREADY stripped at this point, so a decorator failure is not a
        // no-op — it leaves the tree in the exact 5,331-link-loss state the preflight above
        // exists to prevent. Name the recovery rather than letting the stack trace stand as
        // the whole message.
        console.error(
          "⚠ shards were rewritten but NOT re-decorated — every candidateLink is currently " +
            "missing. Re-run `npx tsx scripts/officials/decorate_candidate_links.ts` once " +
            "the cause below is fixed.",
        );
        throw err;
      }
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
