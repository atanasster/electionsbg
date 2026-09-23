import { describe, it, expect } from "vitest";
import { shardsForWindow, type FilterIndexShard } from "./storyQuery";

const shard = (over: Partial<FilterIndexShard> = {}): FilterIndexShard => ({
  path: "stories/filter-index-1.json",
  count: 1500,
  newest: "2026-09-22T00:00:00+00:00",
  oldest: "2026-09-21T00:00:00+00:00",
  undated: 0,
  ...over,
});

const NOW = Date.parse("2026-09-22T12:00:00+00:00");

describe("shardsForWindow", () => {
  it("keeps only the shards a window can match", () => {
    const recent = shard({ path: "a", newest: "2026-09-22T00:00:00+00:00" });
    const old = shard({
      path: "b",
      newest: "2026-08-01T00:00:00+00:00",
      oldest: "2026-07-01T00:00:00+00:00",
    });
    expect(shardsForWindow([recent, old], 1, NOW).map((s) => s.path)).toEqual([
      "a",
    ]);
  });

  it("keeps a shard whose newest row is inside the window even if its oldest is not", () => {
    // ⚠️ Skipping on `oldest` would drop a shard that straddles the boundary,
    // silently narrowing the corpus.
    const straddling = shard({
      path: "s",
      newest: "2026-09-22T00:00:00+00:00",
      oldest: "2016-09-01T00:00:00+00:00",
    });
    expect(shardsForWindow([straddling], 1, NOW)).toHaveLength(1);
  });

  it("reads every shard when there is no window", () => {
    // `withinDays` admits any row at days <= 0, so "all" really means all.
    const shards = [
      shard({ path: "a" }),
      shard({ path: "b", newest: null, oldest: null, undated: 399 }),
    ];
    for (const days of [0, -1, Number.NaN]) {
      expect(shardsForWindow(shards, days, NOW)).toHaveLength(2);
    }
  });

  it("skips an all-undated shard for any real window", () => {
    // ⚠️ An undated row can NEVER satisfy a positive window — `withinDays`
    // refuses a non-ISO stamp — so the shard contributes nothing. Measured:
    // 485 of 4,899 rows carry no date — 399 of them fill the LAST shard,
    // which is why an all-undated shard exists at all.
    const undatedOnly = shard({ newest: null, oldest: null, undated: 399 });
    expect(shardsForWindow([undatedOnly], 30, NOW)).toEqual([]);
    expect(shardsForWindow([undatedOnly], 0, NOW)).toHaveLength(1);
  });

  it("KEEPS a shard whose bound it cannot parse", () => {
    // ⚠️ It might match. Dropping it would narrow the corpus silently, which
    // is the defect this index exists to remove; loading one shard too many
    // only costs bytes.
    const unreadable = shard({ newest: "не се знае" });
    expect(shardsForWindow([unreadable], 1, NOW)).toHaveLength(1);
  });

  it("preserves the manifest's order", () => {
    const shards = [
      shard({ path: "a", newest: "2026-09-22T00:00:00+00:00" }),
      shard({ path: "b", newest: "2026-09-21T00:00:00+00:00" }),
      shard({ path: "c", newest: "2026-09-20T00:00:00+00:00" }),
    ];
    expect(shardsForWindow(shards, 30, NOW).map((s) => s.path)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("includes a row exactly on the boundary", () => {
    const onEdge = shard({
      newest: new Date(NOW - 86_400_000).toISOString(),
      oldest: new Date(NOW - 86_400_000).toISOString(),
    });
    expect(shardsForWindow([onEdge], 1, NOW)).toHaveLength(1);
  });
});
