// The municipal roster ACCUMULATES, and the SHARDS carry only the sitting bench.
//
// WHY THIS EXISTS. `data/officials/municipal/index.json` was written as a single-year
// snapshot — `years: [targetYear]`, no merge with what was already on disk. That file loads
// `official_roster`, which is the ONLY thing `db:resolve:persons` reads to place a municipal
// official, so the register's turnover propagated straight through the identity layer. 2025
// was the tier's first year, so the defect was invisible until the 2026 folder landed on
// 2026-08-14: 334 councillors who had filed in 2025 left the roster, 408 of their filings were
// left with `person_id` NULL, and 321 /person URLs that had been served resolved to nobody.
// Same defect the magistrate roster had (see magistrate_roster_retention.data.test.ts), and
// the same fix.
//
// The tension the split resolves: the my-area and governance roster tiles must show who
// represents a reader NOW, while the person layer, the council-vote roster join and the header
// search index all need everyone who ever served — a councillor who left still cast the votes
// the minutes record. So the index keeps everyone and `currentBench()` is the one place that
// answers "sitting".
//
// Pure unit test — no network, no database, no fixtures on disk.

import { describe, it, expect } from "vitest";
import { mergeIndexEntries, mergeYears } from "./merge";
import { currentBench } from "./build_municipal_shards";
import type {
  MunicipalIndexEntry,
  MunicipalIndexFile,
} from "../../src/data/dataTypes";

const entry = (
  slug: string,
  descriptorYear: number | undefined,
  over: Partial<MunicipalIndexEntry> = {},
): MunicipalIndexEntry => ({
  slug,
  name: slug.toUpperCase(),
  normalizedName: slug.toUpperCase(),
  role: "councillor",
  roleRaw: "Общински съветник",
  municipality: "Гоце Делчев",
  latestDeclarationYear: descriptorYear ?? 2025,
  ...(descriptorYear == null ? {} : { descriptorYear }),
  ...over,
});

const index = (
  entries: MunicipalIndexEntry[],
  years: number[],
  current?: MunicipalIndexFile["current"],
): MunicipalIndexFile => ({
  generatedAt: "2026-08-14T00:00:00.000Z",
  years,
  total: entries.length,
  byRole: {
    mayor: 0,
    deputy_mayor: 0,
    council_chair: 0,
    councillor: entries.length,
    chief_architect: 0,
    other: 0,
  },
  current,
  entries,
});

describe("municipal roster retention", () => {
  // THE regression. Before the fix this run produced exactly `incoming`.
  it("keeps an official the newest listing no longer names", () => {
    const prior = [entry("departed", 2025), entry("stayed", 2025)];
    const incoming = [entry("stayed", 2026), entry("arrived", 2026)];
    const merged = mergeIndexEntries(prior, incoming);
    expect(merged.map((e) => e.slug).sort()).toEqual([
      "arrived",
      "departed",
      "stayed",
    ]);
  });

  it("takes the newest run's descriptors for an official in both", () => {
    const prior = [entry("x", 2025, { municipality: "Стар", role: "mayor" })];
    const incoming = [entry("x", 2026, { municipality: "Нов" })];
    const [only] = mergeIndexEntries(prior, incoming);
    expect(only.municipality).toBe("Нов");
    expect(only.role).toBe("councillor");
    expect(only.descriptorYear).toBe(2026);
  });

  it("accumulates the year list rather than replacing it", () => {
    expect(mergeYears([2025], 2026)).toEqual([2025, 2026]);
    expect(mergeYears([2025, 2026], 2026)).toEqual([2025, 2026]);
    // A backfill lands in order, not at the end.
    expect(mergeYears([2025, 2026], 2019)).toEqual([2019, 2025, 2026]);
  });
});

describe("currentBench", () => {
  it("is the newest register folder, not the union", () => {
    const bench = currentBench(
      index([entry("departed", 2025), entry("stayed", 2026)], [2025, 2026], {
        year: 2026,
        total: 1,
        byRole: {
          mayor: 0,
          deputy_mayor: 0,
          council_chair: 0,
          councillor: 1,
          chief_architect: 0,
          other: 0,
        },
      }),
    );
    expect(bench.year).toBe(2026);
    expect(bench.entries.map((e) => e.slug)).toEqual(["stayed"]);
  });

  // A backfill run (`--year 2019`) must not redefine "sitting" — max(years) stays 2026, so the
  // 2019 rows it adds are retained history and never reach a roster tile.
  it("a backfilled older year does not become the bench", () => {
    const bench = currentBench(
      index(
        [entry("old", 2019), entry("sitting", 2026)],
        [2019, 2025, 2026],
        undefined,
      ),
    );
    expect(bench.year).toBe(2026);
    expect(bench.entries.map((e) => e.slug)).toEqual(["sitting"]);
  });

  // Back-compat: a file written before the roster accumulated has no descriptorYear anywhere
  // and no `current` block. It WAS a single-year snapshot, so every entry is the bench —
  // returning nothing would blank all 288 shards on the first run after this shipped.
  it("treats a pre-accumulation snapshot as all-bench", () => {
    const bench = currentBench(
      index([entry("a", undefined), entry("b", undefined)], [2025]),
    );
    expect(bench.year).toBe(2025);
    expect(bench.entries).toHaveLength(2);
  });

  // The mixed state the repair run itself produces: restored 2025 rows carry no
  // descriptorYear, the 2026 run stamps its own. Anything undated is history, not bench.
  it("excludes undated rows once any row is dated", () => {
    const bench = currentBench(
      index([entry("undated", undefined), entry("dated", 2026)], [2025, 2026]),
    );
    expect(bench.entries.map((e) => e.slug)).toEqual(["dated"]);
  });
});
