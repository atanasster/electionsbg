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

const index = (
  entries: MunicipalIndexEntry[],
  year: number,
): MunicipalIndexFile =>
  ({
    generatedAt: META.generatedAt,
    years: [2025, year],
    total: entries.length,
    byRole: {},
    // The BENCH total, not every entry — `official_roster_obshtina.data.test.ts` derives
    // `retained` from `total - current.total`, so a fixture that inflates it here teaches
    // the wrong shape to anyone copying it.
    current: {
      year,
      total: entries.filter(
        (e) => (e as { descriptorYear?: number }).descriptorYear === year,
      ).length,
      byRole: {},
    },
    entries,
  }) as unknown as MunicipalIndexFile;

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

  // TEST-001: `currentBench` and `emitShards` are separate functions, so "carried onto the
  // bench" and "written into a shard" are separate claims. The second is the one a reader sees.
  it("writes a carried mayor into the município's shard, dated to his own year", () => {
    const dir = mkTmp();
    const bench = currentBench(
      index(
        [
          entry({ slug: "old-mayor", role: "mayor", descriptorYear: 2025 }),
          entry({ slug: "dep", role: "deputy_mayor", descriptorYear: 2026 }),
        ],
        2026,
      ),
    );
    emitShards(bench.entries, META, { shardDir: dir });
    const shard = JSON.parse(
      fs.readFileSync(path.join(dir, "SZR22.json"), "utf8"),
    ) as {
      years: number[];
      byRole: Record<string, number>;
      entries: { slug: string; descriptorYear?: number }[];
    };
    expect(shard.byRole.mayor).toBe(1);
    const carried = shard.entries.find((e) => e.slug === "old-mayor")!;
    // The shard's bench year and the entry's own year disagree ON PURPOSE — that gap is what
    // lets a consumer say "last listed 2025" instead of asserting he was listed this year.
    expect(shard.years).toEqual([2026]);
    expect(carried.descriptorYear).toBe(2025);
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
    expect(currentBench(index(rows, 2026)).carriedMayors).toEqual([]);
  });

  // ⚠️ A MAYOR WITH NO SUCCESSOR IS NOT A VACANCY. The plain year filter published Разлог as a
  // município with three deputy mayors, a council chair and no mayor — a state that does not
  // exist — and the officials/CIK reconcile then reported its elected mayor as not having
  // filed.
  it("carries a mayor forward when the current listing names none", () => {
    const bench = currentBench(
      index(
        [
          entry({ slug: "old-mayor", role: "mayor", descriptorYear: 2025 }),
          entry({ slug: "dep", role: "deputy_mayor", descriptorYear: 2026 }),
        ],
        2026,
      ),
    );
    expect(bench.entries.map((e) => e.slug).sort()).toEqual([
      "dep",
      "old-mayor",
    ]);
    expect(bench.carriedMayors.map((e) => e.slug)).toEqual(["old-mayor"]);
    // ⚠️ The carried row keeps its OWN year. That is the difference between "the mayor is X"
    // and "the register last saw X in 2025"; rewriting it to the bench year would re-create
    // the defect one level up, silently.
    expect(bench.carriedMayors[0]!.descriptorYear).toBe(2025);
  });

  it("does not carry one when the current listing already names a mayor", () => {
    const bench = currentBench(
      index(
        [
          entry({ slug: "old-mayor", role: "mayor", descriptorYear: 2025 }),
          entry({ slug: "new-mayor", role: "mayor", descriptorYear: 2026 }),
        ],
        2026,
      ),
    );
    expect(bench.carriedMayors).toEqual([]);
    expect(bench.entries.map((e) => e.slug)).toEqual(["new-mayor"]);
  });

  it("carries the MOST RECENT prior mayor, not any prior one", () => {
    const bench = currentBench(
      index(
        [
          entry({ slug: "y2019", role: "mayor", descriptorYear: 2019 }),
          entry({ slug: "y2025", role: "mayor", descriptorYear: 2025 }),
          entry({ slug: "dep", role: "deputy_mayor", descriptorYear: 2026 }),
        ],
        2026,
      ),
    );
    expect(bench.carriedMayors.map((e) => e.slug)).toEqual(["y2025"]);
  });

  it("carries per município, never across them", () => {
    const bench = currentBench(
      index(
        [
          entry({
            slug: "a-old",
            role: "mayor",
            municipality: "Разлог",
            descriptorYear: 2025,
          }),
          entry({
            slug: "b-new",
            role: "mayor",
            municipality: "Мъглиж",
            descriptorYear: 2026,
          }),
        ],
        2026,
      ),
    );
    // Мъглиж has a current mayor and must not lend him to Разлог; Разлог carries its own.
    expect(bench.carriedMayors.map((e) => e.municipality)).toEqual(["Разлог"]);
  });

  // TEST-002: `descriptorYear == null` means "written before the roster accumulated", not
  // "listed in year 0". Coercing it would let a pre-accumulation row onto today's bench.
  it("never carries an UNDATED mayor onto a dated bench", () => {
    const bench = currentBench(
      index(
        [
          entry({ slug: "undated", role: "mayor", descriptorYear: undefined }),
          entry({ slug: "dep", role: "deputy_mayor", descriptorYear: 2026 }),
        ],
        2026,
      ),
    );
    expect(bench.carriedMayors).toEqual([]);
  });

  // TEST-003: the case the rule exists for — a município that listed a departing and an
  // arriving mayor in the same year — leaves the two rows equal on year, so the tie-break must
  // be total rather than falling through to name collation.
  it("breaks a same-year tie determinately, not by name", () => {
    const rows = [
      entry({
        slug: "a-earlier",
        role: "mayor",
        descriptorYear: 2025,
        latestDeclarationYear: 2024,
      }),
      entry({
        slug: "z-later",
        role: "mayor",
        descriptorYear: 2025,
        latestDeclarationYear: 2025,
      }),
      entry({ slug: "dep", role: "deputy_mayor", descriptorYear: 2026 }),
    ];
    const forward = currentBench(index(rows, 2026)).carriedMayors;
    const reversed = currentBench(
      index([...rows].reverse(), 2026),
    ).carriedMayors;
    expect(forward.map((e) => e.slug)).toEqual(["z-later"]);
    // Same answer whichever order the index happens to hold them in.
    expect(reversed.map((e) => e.slug)).toEqual(forward.map((e) => e.slug));
  });

  // TEST-004: the carry groups by REGISTRY NAME, which is finer than the shard's obshtina
  // code — the resolver folds Пловдив's six район names into PDV22. A район whose own listing
  // names no mayor must still carry one, even though the city's shard already has a mayor.
  it("carries per registry name, not per folded obshtina code", () => {
    const bench = currentBench(
      index(
        [
          entry({
            slug: "city",
            role: "mayor",
            municipality: "Пловдив",
            descriptorYear: 2026,
          }),
          entry({
            slug: "rayon-old",
            role: "mayor",
            municipality: 'Район "Централен" - Пловдив',
            descriptorYear: 2025,
          }),
        ],
        2026,
      ),
    );
    expect(bench.carriedMayors.map((e) => e.slug)).toEqual(["rayon-old"]);
  });

  // ⚠️ MAYOR ONLY. 56 municipalities have no council chair on the current bench and 53 have
  // NEVER had one, so an absent chair is not evidence that a chair was dropped — carrying it
  // would invent scores of sitting officers from a signal that means nothing.
  it.each(["council_chair", "deputy_mayor", "councillor"] as const)(
    "never carries a %s forward",
    (role) => {
      const bench = currentBench(
        index(
          [
            entry({ slug: "old", role, descriptorYear: 2025 }),
            entry({ slug: "cur", role: "mayor", descriptorYear: 2026 }),
          ],
          2026,
        ),
      );
      expect(bench.carriedMayors).toEqual([]);
      expect(bench.entries.map((e) => e.slug)).toEqual(["cur"]);
    },
  );
});
