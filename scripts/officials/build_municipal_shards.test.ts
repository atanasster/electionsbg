// `emitShards` / `currentBench` — the two rules that decide which officials reach a shard.
//
// Every test writes into an isolated tmp directory via the `shardDir` option, so nothing
// here can touch data/officials/municipal/by_obshtina. Plan:
// docs/plans/officials-roster-missing-mayor-v1.md (T4.1/T4.2).

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emitShards, currentBench } from "./build_municipal_shards";
import type {
  MunicipalIndexEntry,
  MunicipalIndexFile,
} from "../../src/data/dataTypes";

const tmpDirs: string[] = [];
const mkTmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "shards-"));
  tmpDirs.push(d);
  return d;
};
afterEach(() => {
  while (tmpDirs.length)
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

const entry = (over: Partial<MunicipalIndexEntry> = {}): MunicipalIndexEntry =>
  ({
    slug: "ivan-ivanov-000001",
    name: "Иван Иванов",
    normalizedName: "ИВАН ИВАНОВ",
    role: "councillor",
    roleRaw: "Общински съветник",
    municipality: "Мъглиж",
    latestDeclarationYear: 2026,
    descriptorYear: 2026,
    ...over,
  }) as MunicipalIndexEntry;

const META = { generatedAt: "2026-09-04T00:00:00.000Z", years: [2026] };

describe("emitShards", () => {
  it("writes one shard per resolved obshtina and reports nothing unmatched", () => {
    const dir = mkTmp();
    const res = emitShards(
      [entry(), entry({ slug: "b-2", municipality: "Макреш" })],
      META,
      { shardDir: dir },
    );
    expect(res.unmatched).toEqual([]);
    expect(res.stale).toEqual([]);
    expect(res.shardsWritten).toBe(2);
    expect(fs.readdirSync(dir).sort()).toEqual(["SZR22.json", "VID25.json"]);
  });

  it("collects an unresolvable name instead of dropping or guessing it", () => {
    // The resolver refuses a bare ambiguous name; the emit must surface that as `unmatched`
    // so the caller can escalate. Silently omitting the row is how officials disappear.
    const dir = mkTmp();
    const res = emitShards([entry({ municipality: "Бяла" })], META, {
      shardDir: dir,
    });
    expect(res.unmatched.map((u) => u.municipality)).toEqual(["Бяла"]);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  // ⚠️ The emit is additive — it never unlinks — so a município that stops resolving keeps
  // serving its previous shard. That was harmless while every name resolved and is not now.
  it("reports a shard this run did not produce as stale", () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, "ZZZ99.json"), "{}");
    const res = emitShards([entry()], META, { shardDir: dir });
    expect(res.stale).toEqual(["ZZZ99.json"]);
    // Reported, NOT deleted: an orphan may be a município this run failed to resolve, and
    // unlinking on a bad run destroys the only copy.
    expect(fs.existsSync(path.join(dir, "ZZZ99.json"))).toBe(true);
  });

  // A dry run is the safe preview for a command that rewrites every shard twice, so its
  // count must be the blast radius. `shardsWritten++` inside `if (!dryRun)` reported 0.
  it("a dry run counts the shards it would write and writes none", () => {
    const dir = mkTmp();
    const res = emitShards(
      [entry(), entry({ slug: "b-2", municipality: "Макреш" })],
      META,
      {
        shardDir: dir,
        dryRun: true,
      },
    );
    expect(res.shardsWritten).toBe(2);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe("currentBench", () => {
  const index = (
    entries: MunicipalIndexEntry[],
    year: number,
  ): MunicipalIndexFile =>
    ({
      generatedAt: META.generatedAt,
      years: [2025, year],
      total: entries.length,
      byRole: {},
      current: { year, total: entries.length, byRole: {} },
      entries,
    }) as unknown as MunicipalIndexFile;

  it("keeps only the officials the newest register listing names", () => {
    const bench = currentBench(
      index(
        [
          entry({ descriptorYear: 2026 }),
          entry({ slug: "old", descriptorYear: 2025 }),
        ],
        2026,
      ),
    );
    expect(bench.year).toBe(2026);
    expect(bench.entries.map((e) => e.slug)).toEqual(["ivan-ivanov-000001"]);
  });

  // A file written before the roster accumulated has no descriptorYear anywhere; that WAS a
  // single-year snapshot, so every row is the bench. Returning nothing would blank the tree.
  it("treats an index with no descriptorYear as entirely current", () => {
    const rows = [
      entry({ descriptorYear: undefined }),
      entry({ slug: "b-2", descriptorYear: undefined }),
    ];
    expect(currentBench(index(rows, 2026)).entries).toHaveLength(2);
  });
});
