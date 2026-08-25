// Gate over the REAL data/council/ corpus: index.json and the durable
// per-resolution shard tree must agree, in BOTH directions.
//
// The drift this closes served a 200 and reconciled against nothing for three
// days behind a fully passing suite. `meta.<code>.resolutionCount` had two
// definitions written by two writers into one field —
//
//   mergeMuniResult           |index-window U durable U this scrape|
//   rebuildShardsFromDurable  |durable|
//
// — which were numerically EQUAL on every município until 2026-08-22, when
// `cbbcd220e4` purged 84 phantom resolutions: it deleted their durable shards
// and left their rows in `resolutionsByObshtina`. From then on the union
// writer over-reported by exactly that residue (RSE01 published 507 against
// 426 shards on disk) and the value alternated run by run depending on which
// writer touched it last, while the shard tree sat stable.
//
// Why the existing gates could not see it:
//   - `index_writer.test.ts` runs on a `mkdtemp` fixture. It proves the RULE
//     and says nothing about the committed artifact.
//   - `council_corpus.data.test.ts` compares Postgres to the shard tree and
//     deliberately never reads index.json (its header explains why: the index
//     is capped at 200 rows per município, so it cannot be the reference for
//     a corpus total).
//   Nothing checked the artifact against the tree. This does.
//
// It is a PLAIN vitest file, not a `.data.test.ts`, on purpose: those skip
// when Postgres is down, and a dirty index must fail on a checkout with no
// database at all. It reads only directory ENTRIES — no file contents beyond
// index.json — so it is milliseconds over 4,813 shards.
//
// ⚠️ That names-only walk makes this a THIRD implementation of the shard-tree
// walk (`load_council_pg.ts`'s `readDurable` and `index_writer.ts`'s
// `readDurableResolutions` both parse). Do not consolidate them: the
// divergence is the point — sharing an implementation would either drag 4,813
// file reads into the unit suite or weaken the loader. What the difference
// costs is recorded on the count assertion below.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";

const BASE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../data/council",
);
const INDEX = join(BASE, "index.json");

/** Município directories actually on disk. `votes` is a real sibling holding
 *  the per-município named-vote shards, not a município. */
const shardDirs = (): string[] =>
  existsSync(BASE)
    ? readdirSync(BASE, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== "votes")
        .map((e) => e.name)
        .sort()
    : [];

/** Shard ids for one município: data/council/<code>/<YYYY>/<id>.json. */
const durableIds = (code: string): Set<string> => {
  const ids = new Set<string>();
  const dir = join(BASE, code);
  if (!existsSync(dir)) return ids;
  for (const year of readdirSync(dir, { withFileTypes: true })) {
    if (!year.isDirectory()) continue;
    for (const f of readdirSync(join(dir, year.name))) {
      if (f.endsWith(".json")) ids.add(f.slice(0, -".json".length));
    }
  }
  return ids;
};

type IndexFile = {
  resolutionsByObshtina: Record<string, { id?: unknown }[]>;
  meta?: Record<string, { resolutionCount: number } | undefined>;
};

const present = existsSync(INDEX);
const skipCorpus = present
  ? false
  : "data/council/index.json absent — it is committed, so this is a sparse checkout";
reportSkip(import.meta.url, skipCorpus);

// OUTSIDE the skipped describe, deliberately. `data/council/` is committed
// (4,820 tracked files) and CI does a full `actions/checkout`, so absence is a
// broken tree rather than a supported state — and a skip is invisible in the
// aggregate CI summary, where every `*.data.test.ts` also skips without
// Postgres. The skip below keeps the file runnable in a sparse checkout; this
// makes absence produce a red line rather than a silent +N on the skip count.
// OUTSIDE any gate, deliberately — these are COMMITTED, so absence is a broken
// working copy rather than a supported state. See scripts/lib/assert_committed.ts.
assertCommitted("data/council");

it("the council corpus is present", () => {
  expect(present, `${INDEX} is missing — data/council/ is committed`).toBe(
    true,
  );
});

describe.skipIf(skipCorpus)(
  "data/council/index.json agrees with the shard tree",
  () => {
    const idx = JSON.parse(readFileSync(INDEX, "utf8")) as IndexFile;

    // Drive from the UNION, for the same reason `rebuildShardsFromDurable` does:
    // iterating the index alone would let the index hide data from the gate that
    // exists to check the index. `load_council_pg.ts` agrees — its `councilCodes`
    // enumerates DIRECTORIES — so a município dropped from the index would still
    // be served by Postgres while this gate reported the artifact clean.
    const dirs = shardDirs();
    const codes = [
      ...new Set([...Object.keys(idx.resolutionsByObshtina), ...dirs]),
    ].sort();
    // Walk once. Two arms calling `durableIds` independently could in principle
    // observe different trees if the corpus moved mid-run.
    const trees = new Map(codes.map((c) => [c, durableIds(c)] as const));

    it("has the whole corpus to check", () => {
      // A RATCHET, not `> 0`: `> 0` is satisfied by 1 of 16, which would leave
      // every per-município arm below running once and reporting success. 16 is
      // the wired set; a new município raises this line.
      expect(codes.length).toBeGreaterThanOrEqual(16);
    });

    it("every município with a durable tree has an index slot", () => {
      // The COVERAGE direction. The subset direction below cannot see a
      // município that left the index entirely — it would simply emit no case.
      const unindexed = dirs.filter((c) => !(c in idx.resolutionsByObshtina));
      expect(
        unindexed,
        "municipalities with shards on disk and no `resolutionsByObshtina` slot " +
          "— Postgres serves these (load_council_pg drives from directories) " +
          "while the index has lost them",
      ).toEqual([]);
    });

    it.each(codes)("%s: every index row has a durable shard", (code) => {
      const ids = trees.get(code)!;
      // Anti-vacuity: an empty tree makes the subset check trivially true, and
      // is itself the state a misdirected read produces.
      expect(ids.size, `${code}: durable tree is empty`).toBeGreaterThan(0);

      const rows = idx.resolutionsByObshtina[code] ?? [];
      // A window that collapsed to [] satisfies every other arm here as long as
      // the count still matches the tree — and the council page renders this
      // window, with /council/resolution/** reachable only through it.
      expect(
        rows.length,
        `${code}: index window is empty while ${ids.size} shard(s) sit on disk`,
      ).toBeGreaterThan(0);

      // A row with no id is a THIRD cause with a third response: it is a broken
      // index row, and `rebuild_shards.ts` will not fix it. Separated so the
      // orphan report below cannot print `[undefined]` beside the wrong advice.
      const malformed = rows.filter((r) => typeof r?.id !== "string");
      expect(
        malformed.length,
        `${code}: index rows with no string \`id\` — a broken index row, not a ` +
          `purge residue`,
      ).toBe(0);

      const orphans = rows
        .map((r) => r.id as string)
        .filter((id) => !ids.has(id));
      // Name them. A bare count cannot tell a purge residue from an id-scheme
      // change, and those want opposite responses — the first is repaired with
      // `npm run council:rebuild-shards`, the second means a parser moved
      // every id in a protocol and the tree is the thing to look at.
      expect(
        orphans,
        `${code}: index rows with no durable shard — repair with ` +
          `\`npm run council:rebuild-shards\``,
      ).toEqual([]);
    });

    it.each(codes)(
      "%s: meta.resolutionCount equals the shard count",
      (code) => {
        const ids = trees.get(code)!;
        expect(ids.size, `${code}: durable tree is empty`).toBeGreaterThan(0);
        expect(
          idx.meta?.[code]?.resolutionCount,
          `${code}: meta.resolutionCount must count the durable tree. That is the ` +
            `FILENAME count here; load_council_pg.ts counts PARSED, shape-checked ` +
            `shards (resolution_count: rows.length), so the two agree only while ` +
            `every shard parses — one unreadable shard splits them silently, with ` +
            `a console.warn in a loader nobody is watching`,
        ).toBe(ids.size);
      },
    );

    it.each(codes)(
      "%s: every shard sits under the year its id names",
      (code) => {
        // `pruneToDurable`'s safety argument leans on this (its property 4), and
        // nothing over the real corpus held it: `durableIds` flattens every year
        // directory into one set, so a shard filed under the wrong year is
        // indistinguishable from a correct one. A tripwire, not a repair —
        // measured 0 violations across all 4,813 shards.
        const wrong: string[] = [];
        const dir = join(BASE, code);
        if (existsSync(dir)) {
          for (const year of readdirSync(dir, { withFileTypes: true })) {
            if (!year.isDirectory()) continue;
            for (const f of readdirSync(join(dir, year.name))) {
              if (!f.endsWith(".json")) continue;
              // NOT `[A-Z]{3}\d{2}` — Sofia's synthetic key is a bare `SOF`, and
              // an id regex that excluded it once cost all 413 Sofia resolutions
              // their page (see CLAUDE.md on /council/resolution/**).
              const m = /^([A-Z0-9_]+)-(\d{4})-/.exec(
                f.slice(0, -".json".length),
              );
              if (!m || m[1] !== code || m[2] !== year.name) {
                wrong.push(`${year.name}/${f}`);
              }
            }
          }
        }
        expect(
          wrong,
          `${code}: shards whose id disagrees with their path`,
        ).toEqual([]);
      },
    );

    it("the window never exceeds the history it claims", () => {
      // The cheap cross-check, needing no filesystem walk at all: a window
      // larger than the count it declares is self-evidently wrong from the
      // artifact alone. It would have fired on the purge commit itself —
      // verified against `cbbcd220e4`'s own index.json, where all three are over
      // (RSE01 200 rows/130, PVN01 137/135, VAR01 81/80).
      //
      // The signal then decayed in TWO steps, not one, and the larger was not
      // the ingest: `82431d35f2` — hours later, the same day — resynced RSE01's
      // count 130 -> 426 while all 81 orphan rows stayed, taking the biggest arm
      // out of the set two days early; the 2026-08-24 ingest cleared PVN01 and
      // VAR01. Which is why the shard-based arms above, not this one, are the
      // primary gate — this survives only as a tripwire against them both being
      // weakened to read the index instead of the tree.
      const over = codes.filter(
        (c) =>
          (idx.resolutionsByObshtina[c] ?? []).length >
          (idx.meta?.[c]?.resolutionCount ?? 0),
      );
      expect(
        over,
        "municipalities whose index window exceeds their count",
      ).toEqual([]);
    });
  },
);
