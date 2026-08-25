// Gates for the votes-shard merge.
//
// The defect these close destroyed served data while every row count
// reconciled. `writeIndex` strips `tally.perCouncillor`, and `mergeMuniResult`
// used to read its previous state back out of that stripped index and REBUILD
// the votes shard from it — so the shard could only ever hold what the current
// scrape returned. Measured 2026-08-16: 530 resolutions and 10,754
// per-councillor rows sat in the durable tree and were not served.
//
// The only thing preventing a total wipe was the `kept === 0` early return, so
// the corpus was protected by the extraction being broken. Re-enabling
// extraction — the obvious one-line fix — would have overwritten each shard
// with a single resolution.

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as writer from "./index_writer";
import type {
  CouncilIndexFile,
  CouncilResolution,
  MuniScrapeResult,
} from "./types";

const CODE = "TST01";
const MUNI = "Община Тест";

let dir: string;

const pc = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Councillor ${i}`,
    normKey: `councillor ${i}`,
    vote: "for" as const,
  }));

const resolution = (
  id: string,
  date: string,
  opts: { named?: number } = {},
): CouncilResolution => ({
  id,
  date,
  session: "1",
  number: id.slice(-3),
  title: `Решение ${id}`,
  result: "adopted",
  sourceUrl: `https://example.invalid/${id}.pdf`,
  tally: {
    for: opts.named ?? 10,
    against: 0,
    abstain: 0,
    method: opts.named ? "named" : "open",
    ...(opts.named ? { perCouncillor: pc(opts.named) } : {}),
  },
});

const scrape = (resolutions: CouncilResolution[]): MuniScrapeResult => ({
  obshtinaCode: CODE,
  resolutions,
  protocolsTouched: 1,
  errors: [],
});

/** Write a durable per-resolution shard, as writeResolutionShard would. */
const putDurable = async (r: CouncilResolution) => {
  const d = join(dir, CODE, r.date.slice(0, 4));
  await mkdir(d, { recursive: true });
  await writeFile(join(d, `${r.id}.json`), JSON.stringify(r), "utf8");
};

const readDurable = async (r: CouncilResolution): Promise<CouncilResolution> =>
  JSON.parse(
    await readFile(join(dir, CODE, r.date.slice(0, 4), `${r.id}.json`), "utf8"),
  );

const putIndex = async (rows: CouncilResolution[]) => {
  const idx: CouncilIndexFile = {
    source: "test",
    indexName: "test",
    tags: {} as CouncilIndexFile["tags"],
    resolutionsByObshtina: { [CODE]: rows },
    meta: {
      [CODE]: {
        name: MUNI,
        lastIngest: "2026-01-01T00:00:00.000Z",
        protocolsIngested: 0,
        resolutionCount: rows.length,
      },
    },
  };
  await writeFile(join(dir, "index.json"), JSON.stringify(idx), "utf8");
};

const readIndexFile = async (): Promise<CouncilIndexFile> =>
  JSON.parse(await readFile(join(dir, "index.json"), "utf8"));

const votesPath = () => join(dir, "votes", `${CODE}.json`);

const readVotes = async (): Promise<Record<string, unknown[]>> =>
  JSON.parse(await readFile(votesPath(), "utf8")).votesById;

/**
 * `n` historical resolutions WITH named votes, in the durable tree and — as
 * the real index always is — STRIPPED in the index slot.
 *
 * The strip is re-implemented here rather than imported from the module under
 * test. That duplication is deliberate: importing `stripPerCouncillor` would
 * make the fixture agree with the implementation by construction, and these
 * tests exist precisely to check that the index cannot carry named votes.
 */
const seedHistory = async (n: number, perMuni = 3) => {
  const rows: CouncilResolution[] = [];
  for (let i = 0; i < n; i++) {
    const r = resolution(
      `${CODE}-2025-prot1-r${String(i).padStart(3, "0")}`,
      `2025-06-${String((i % 28) + 1).padStart(2, "0")}`,
      { named: perMuni },
    );
    await putDurable(r);
    const { perCouncillor: _drop, ...tally } = r.tally!;
    void _drop;
    rows.push({ ...r, tally });
  }
  await putIndex(rows);
  return rows;
};

beforeEach(async () => {
  // COUNCIL_DATA_DIR is resolved per call inside the module, so no chdir and
  // no module-cache juggling — the module is imported once, at the top.
  dir = await mkdtemp(join(tmpdir(), "council-iw-"));
  process.env.COUNCIL_DATA_DIR = dir;
});

afterEach(async () => {
  delete process.env.COUNCIL_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("votes shard merge", () => {
  it("keeps history when a scrape carries named votes for one resolution", async () => {
    await seedHistory(170);
    await writer.rebuildShardsFromDurable();
    expect(Object.keys(await readVotes())).toHaveLength(170);

    const fresh = resolution(`${CODE}-2026-prot9-r900`, "2026-08-01", {
      named: 3,
    });
    await writer.mergeMuniResult(scrape([fresh]), MUNI);

    const after = await readVotes();
    expect(Object.keys(after)).toHaveLength(171);
    expect(after[fresh.id]).toHaveLength(3);
  });

  it("keeps named votes for resolutions that aged out of the index window", async () => {
    // THE test for rule 2 (merge, not replace). With a 5-row window, 15 of the
    // 20 named resolutions are absent from `capped` entirely — so a replace
    // writes 5 or 6 and only a merge preserves 21. This is the DOMINANT state
    // of the real corpus, not an edge case: all 75 of Sofia's named rows sit
    // outside the window, as do 294 of PER32's 370 and 259 of VTR01's 383.
    await seedHistory(20);
    await writer.rebuildShardsFromDurable();
    expect(Object.keys(await readVotes())).toHaveLength(20);

    const fresh = resolution(`${CODE}-2026-p9-r900`, "2026-08-01", {
      named: 3,
    });
    await writer.mergeMuniResult(scrape([fresh]), MUNI, { perMuniLimit: 5 });

    expect(Object.keys(await readVotes())).toHaveLength(21);
  });

  it("rebuilds the shard from the durable tree when no shard exists", async () => {
    const rows = await seedHistory(170);
    await rm(join(dir, "votes"), { recursive: true, force: true });

    const fresh = resolution(`${CODE}-2026-prot9-r900`, "2026-08-01", {
      named: 3,
    });
    await writer.mergeMuniResult(scrape([fresh]), MUNI);

    const after = await readVotes();
    expect(Object.keys(after)).toHaveLength(171);
    // The point: the 170 came from the DURABLE TREE. The index rows the merge
    // also reads carry no perCouncillor at all.
    expect(after[rows[0].id]).toHaveLength(3);
    expect(rows[0].tally).not.toHaveProperty("perCouncillor");
  });

  it("recovers named votes the stripped index cannot carry", async () => {
    const hidden = resolution(`${CODE}-2025-prot2-r050`, "2025-07-01", {
      named: 4,
    });
    await putDurable(hidden);
    await putIndex([]);

    const fresh = resolution(`${CODE}-2026-prot9-r900`, "2026-08-01", {
      named: 3,
    });
    await writer.mergeMuniResult(scrape([fresh]), MUNI);

    const after = await readVotes();
    expect(Object.keys(after).sort()).toEqual([hidden.id, fresh.id].sort());
    expect(after[hidden.id]).toHaveLength(4);
  });

  it("an empty scrape cannot wipe a populated shard", async () => {
    await seedHistory(12);
    await writer.rebuildShardsFromDurable();
    expect(Object.keys(await readVotes())).toHaveLength(12);

    await writer.mergeMuniResult(scrape([]), MUNI);
    expect(Object.keys(await readVotes())).toHaveLength(12);
  });

  it("does not rewrite the shard when the run contributed nothing", async () => {
    await seedHistory(5);
    await writer.rebuildShardsFromDurable();
    const before = JSON.parse(await readFile(votesPath(), "utf8")).lastIngest;

    await writer.mergeMuniResult(scrape([]), MUNI);

    const after = JSON.parse(await readFile(votesPath(), "utf8")).lastIngest;
    // A frozen corpus must not look freshly ingested — that is what hid the
    // 2026-05 freeze for two and a half months.
    expect(after).toBe(before);
  });

  it("writes no shard for a município with no named-vote data at all", async () => {
    const plain = resolution(`${CODE}-2026-prot1-r001`, "2026-08-01");
    await putIndex([]);
    await writer.mergeMuniResult(scrape([plain]), MUNI);

    await expect(readVotes()).rejects.toThrow();
  });
});

describe("named votes are never displaced by a flagless re-scrape", () => {
  it("keeps the durable shard's per-councillor block", async () => {
    const named = resolution(`${CODE}-2025-p1-r001`, "2025-06-01", {
      named: 4,
    });
    await putDurable(named);
    await putIndex([]);

    // The daily path runs WITHOUT --per-councillor, so a re-emitted resolution
    // arrives with no named-vote block at all.
    const flagless = resolution(`${CODE}-2025-p1-r001`, "2025-06-01");
    expect(flagless.tally?.perCouncillor).toBeUndefined();
    await writer.mergeMuniResult(scrape([flagless]), MUNI);

    expect((await readDurable(named)).tally?.perCouncillor).toHaveLength(4);
    // …and the shard the site serves still has them too.
    expect((await readVotes())[named.id]).toHaveLength(4);
  });

  it("a scrape WITH named votes still overwrites the old block", async () => {
    const named = resolution(`${CODE}-2025-p1-r001`, "2025-06-01", {
      named: 4,
    });
    await putDurable(named);
    await putIndex([]);

    const richer = resolution(`${CODE}-2025-p1-r001`, "2025-06-01", {
      named: 7,
    });
    await writer.mergeMuniResult(scrape([richer]), MUNI);

    expect((await readDurable(named)).tally?.perCouncillor).toHaveLength(7);
  });
});

describe("shrink guard", () => {
  // The guard is unreachable through mergeMuniResult BY CONSTRUCTION: the
  // accumulator is seeded from the shard on disk, so a merge can only ever add
  // entries. That is the point — it is a tripwire for a future revert of the
  // merge to a replace. So the arming semantics are tested directly, and the
  // "a merge never shrinks" property is asserted through the public API below.
  it("refuses a real shrink", () => {
    expect(writer.shouldRefuseShrink(20, 5)).toBe(true);
    expect(writer.shouldRefuseShrink(370, 76)).toBe(true);
  });

  it("allows growth and no-ops", () => {
    expect(writer.shouldRefuseShrink(20, 21)).toBe(false);
    expect(writer.shouldRefuseShrink(20, 20)).toBe(false);
    expect(writer.shouldRefuseShrink(0, 0)).toBe(false);
  });

  it("tolerates a drop within 5% but not beyond it", () => {
    // floor(100 * 0.95) = 95 — 95 passes, 94 does not.
    expect(writer.shouldRefuseShrink(100, 95)).toBe(false);
    expect(writer.shouldRefuseShrink(100, 94)).toBe(true);
  });

  it("has an absolute floor so small municipalities are protected", () => {
    // A bare 5% tolerance is inert below ~20 entries: floor(6 * 0.95) = 5, so
    // 6 -> 5 would pass on percentage alone. The absolute floor is what makes
    // the check mean anything for a município early in its coverage.
    expect(writer.shouldRefuseShrink(6, 5)).toBe(false); // 1 lost — noise
    expect(writer.shouldRefuseShrink(6, 4)).toBe(true); // 2 lost — refuse
  });

  it("allowShrink is the deliberate override", () => {
    expect(writer.shouldRefuseShrink(20, 5, true)).toBe(false);
  });

  it("a merge through the public API never shrinks the shard", async () => {
    await seedHistory(20);
    await writer.rebuildShardsFromDurable();
    // Durable tree gone, tiny window, one fresh resolution: every input that
    // could plausibly shrink the shard, and it still grows.
    await rm(join(dir, CODE), { recursive: true, force: true });
    const one = resolution(`${CODE}-2026-p9-r900`, "2026-08-01", { named: 3 });
    await putDurable(one);

    // `allowPrune` is REQUIRED here and is not a weakening of this assertion.
    // Deleting the tree under a populated index is precisely what the prune
    // ceiling refuses, so without the override this fixture now throws before
    // `writeVotesShard` is ever reached — i.e. the guard makes the input
    // unreachable through the public API, while the property being asserted
    // (the shard merges rather than replaces) is still worth pinning. Do not
    // remove the flag to "make it realistic": the realistic version of this
    // input is the one `prune ceiling` below asserts we refuse.
    await writer.mergeMuniResult(scrape([one]), MUNI, {
      perMuniLimit: 1,
      allowPrune: true,
    });
    expect(Object.keys(await readVotes())).toHaveLength(21);
  });
});

describe("corrupt and malformed input", () => {
  it("refuses to write a shard whose date cannot form a year directory", async () => {
    // `join(dataDir(), obshtina, "")` is the município ROOT, and
    // listDurableShardPaths only descends DIRECTORIES — so a shard landing
    // there is invisible to the tree walk. Its id would still reach the index,
    // and the prune would then delete that row on the very next run. Before
    // the prune existed such a row merely persisted; now it is silent data
    // loss, which is why the refusal is at the write.
    await seedHistory(3);
    const bad = {
      ...resolution(`${CODE}-2026-p9-r900`, "2026-08-01"),
      date: "",
    };

    await expect(writer.mergeMuniResult(scrape([bad]), MUNI)).rejects.toThrow(
      /refusing to write a shard with date/,
    );

    // Nothing at the município root, and the index is untouched — shards are
    // written BEFORE the index, so the throw persists neither.
    const rootEntries = await readdir(join(dir, CODE), { withFileTypes: true });
    expect(rootEntries.filter((e) => e.isFile())).toHaveLength(0);
    expect((await readIndexFile()).resolutionsByObshtina[CODE]).toHaveLength(3);
  });

  it("refuses to rebuild a votes shard that exists but does not parse", async () => {
    await seedHistory(20);
    await writer.rebuildShardsFromDurable();
    const raw = await readFile(votesPath(), "utf8");
    await writeFile(votesPath(), raw.slice(0, 40), "utf8");

    // Treating a truncated shard as absent would silently rewrite it from the
    // index window — measured at 20 -> 5, with no error.
    await expect(writer.mergeMuniResult(scrape([]), MUNI)).rejects.toThrow(
      /does not parse/,
    );
  });

  it("skips one unparseable durable shard without losing the município", async () => {
    await seedHistory(5);
    await writeFile(join(dir, CODE, "2025", "broken.json"), "{oops", "utf8");

    const r = await writer.rebuildShardsFromDurable();
    expect(r.resolutionsWithVotes).toBe(5);
  });

  it("skips a durable shard that parses to null", async () => {
    await seedHistory(5);
    await writeFile(join(dir, CODE, "2025", "nulled.json"), "null", "utf8");

    // Without the shape check this is a TypeError on `.id` — costing the
    // município its entire history, the outcome the skip exists to prevent.
    const r = await writer.rebuildShardsFromDurable();
    expect(r.resolutionsWithVotes).toBe(5);
  });
});

describe("meta.resolutionCount", () => {
  it("does not collapse to the index cap", async () => {
    await seedHistory(20);
    const fresh = resolution(`${CODE}-2026-p9-r900`, "2026-08-01", {
      named: 3,
    });

    const out = await writer.mergeMuniResult(scrape([fresh]), MUNI, {
      perMuniLimit: 5,
    });

    // 21 distinct resolutions exist; the index shows 5 of them.
    expect(out.total).toBe(21);
    const idx = await readIndexFile();
    expect(idx.meta?.[CODE].resolutionCount).toBe(21);
    expect(idx.resolutionsByObshtina[CODE]).toHaveLength(5);
  });

  /**
   * The test above CANNOT fail on the drift these two close, and that is why
   * they exist. `seedHistory` puts every row in both the durable tree and the
   * index slot, so |index ∪ durable| == |durable| and the assertion passes
   * whichever of the two the implementation counts.
   *
   * The real corpus stopped satisfying that on 2026-08-22, when `cbbcd220e4`
   * purged 84 phantom resolutions: it deleted their durable shards and left
   * their rows in `resolutionsByObshtina`. From then on the two writers
   * disagreed by exactly that residue — `mergeMuniResult` (union) published
   * RSE01 at 507 against 426 shards, `rebuildShardsFromDurable` (tree) at 426
   * — and the field alternated between them, run by run, for three days.
   *
   * Which mutation kills which arm, verified rather than assumed:
   *   - delete the PRUNE  → the row arm fails (the withdrawn row survives in
   *     the window); the count arm still passes, held up by the tree-derived
   *     count alone.
   *   - delete the prune AND revert the count to `byId.size` → both fail.
   * The two fixes are deliberately layered: with the prune in place the index
   * window is a subset of the tree, so `byId.size` happens to be right again
   * — deriving the count from the tree anyway is what stops that correctness
   * being a side effect of somebody else's line.
   */
  it("counts the durable tree, not the stale index window", async () => {
    const rows = await seedHistory(10);
    // A resolution a purge withdrew: its row is still in the index slot, its
    // shard is gone. No `putDurable`, deliberately.
    const purged = resolution(`${CODE}-2026-prot9-r001`, "2026-07-01");
    await putIndex([purged, ...rows]);

    // A zero-resolution run — the 2026-08-24 shape. Nothing is scraped,
    // nothing is written to the tree, and the count still moved by +84.
    const out = await writer.mergeMuniResult(scrape([]), MUNI);

    expect(out.total).toBe(10);
    const idx = await readIndexFile();
    expect(idx.meta?.[CODE].resolutionCount).toBe(10);

    // Not merely uncounted — GONE. Leaving it in the window would keep it as
    // the merge basis for every future run, so it re-enters `byId` forever.
    const ids = idx.resolutionsByObshtina[CODE].map((r) => r.id);
    expect(ids).not.toContain(purged.id);
    expect(ids).toHaveLength(10);
  });

  it("agrees with rebuildShardsFromDurable on the same corpus", async () => {
    const rows = await seedHistory(10);
    const purged = resolution(`${CODE}-2026-prot9-r001`, "2026-07-01");
    await putIndex([purged, ...rows]);

    await writer.mergeMuniResult(scrape([]), MUNI);
    const afterMerge = (await readIndexFile()).meta?.[CODE].resolutionCount;
    await writer.rebuildShardsFromDurable();
    const afterRebuild = (await readIndexFile()).meta?.[CODE].resolutionCount;

    // The alternation itself, asserted as an equality rather than inferred
    // from two separate expectations that could both drift.
    expect(afterMerge).toBe(afterRebuild);
    expect(afterMerge).toBe(10);
  });

  it("a resolution scraped in this run counts before its shard is read back", async () => {
    // The count is computed BEFORE `writeResolutionShard` runs, so a
    // tree-derived count has to union this run's own persisted ids or it
    // under-reports every fresh resolution by exactly the batch size.
    //
    // "does not collapse to the index cap" above also fails on that mutation,
    // incidentally — its name does not say so, and narrowing it would remove
    // the coverage silently. This is the arm that states the property.
    await seedHistory(10);
    const fresh = resolution(`${CODE}-2026-prot9-r900`, "2026-08-01");

    const out = await writer.mergeMuniResult(scrape([fresh]), MUNI);

    expect(out.total).toBe(11);
    expect((await readIndexFile()).meta?.[CODE].resolutionCount).toBe(11);
  });

  it("derives the count from the tree even where the prune already makes byId right", async () => {
    // NOT a behaviour test, and it cannot be one: with the prune in place
    // `byId` IS `durable ∪ toPersist`, so the two expressions are equal by
    // construction and reverting the count to `byId.size` passes all the
    // black-box arms above (verified — 25/25).
    //
    // What B1 buys is that the count's correctness does not DEPEND on the
    // prune's, so removing one cannot quietly re-break the other. That is a
    // property of the shape, so the shape is what is asserted. Same class of
    // gate as `src/entryGraph.test.ts` and `reload_visibility_map.data.test.ts`
    // — invisible in review, expensive to catch any other way.
    const src = await readFile(
      new URL("./index_writer.ts", import.meta.url),
      "utf8",
    );
    const body = src.slice(src.indexOf("export const mergeMuniResult"));
    expect(body).toMatch(/const knownIds = new Set\(durable\.ids\)/);
    expect(body).not.toMatch(/resolutionCount = byId\.size/);
  });
});

describe("prune ceiling", () => {
  it("refuses to prune a município whose durable tree has gone missing", async () => {
    // ENOENT on the shard dir is indistinguishable from "no shards yet", so an
    // absent tree presents as "every row was purged". Measured before the
    // guard: 300 of 300 rows deleted, resolutionCount published as 0, exit 0.
    const rows = Array.from({ length: 20 }, (_, i) =>
      resolution(
        `${CODE}-2025-prot1-r${String(i).padStart(3, "0")}`,
        "2025-06-01",
      ),
    );
    await putIndex(rows); // NO putDurable — the tree is absent

    await expect(writer.mergeMuniResult(scrape([]), MUNI)).rejects.toThrow(
      /refusing to prune/,
    );
    // The index is written LAST, so a throw must persist nothing.
    expect((await readIndexFile()).resolutionsByObshtina[CODE]).toHaveLength(
      20,
    );
    expect((await readIndexFile()).meta?.[CODE].resolutionCount).toBe(20);
  });

  it("still prunes a purge residue that is large but a minority of the window", async () => {
    // Non-vacuity: the ceiling must not disarm the prune it protects. This is
    // RSE01's real shape — well past the absolute floor, well under the
    // fraction (81 of 200 = 40.5%).
    const rows = await seedHistory(12);
    const purged = Array.from({ length: 8 }, (_, i) =>
      resolution(
        `${CODE}-2026-prot9-r${String(i).padStart(3, "0")}`,
        "2026-07-01",
      ),
    );
    await putIndex([...purged, ...rows]);

    await writer.mergeMuniResult(scrape([]), MUNI);

    const idx = await readIndexFile();
    expect(idx.resolutionsByObshtina[CODE]).toHaveLength(12);
    expect(idx.meta?.[CODE].resolutionCount).toBe(12);
  });

  it("arms on a floor and a fraction, and allowPrune is the deliberate override", () => {
    expect(writer.shouldRefusePrune(300, 300)).toBe(true);
    // Under the absolute floor — PVN01 (2 of 137) and VAR01 (1 of 81).
    expect(writer.shouldRefusePrune(137, 2)).toBe(false);
    expect(writer.shouldRefusePrune(81, 1)).toBe(false);
    // Over the floor, under the fraction — RSE01 (81 of 200).
    expect(writer.shouldRefusePrune(200, 81)).toBe(false);
    // Over both.
    expect(writer.shouldRefusePrune(200, 101)).toBe(true);
    // A tiny município losing everything stays under the floor deliberately:
    // 4 of 4 is not distinguishable from a genuinely small purge.
    expect(writer.shouldRefusePrune(4, 4)).toBe(false);
    expect(writer.shouldRefusePrune(300, 300, true)).toBe(false);
  });
});

describe("rebuildShardsFromDurable", () => {
  it("rebuilds from the durable tree, not the stripped index", async () => {
    await seedHistory(9);
    const r = await writer.rebuildShardsFromDurable();

    expect(r.shardsWritten).toBe(1);
    expect(r.resolutionsWithVotes).toBe(9);
    expect(r.voteRows).toBe(27); // 9 resolutions x 3 councillors
    expect(Object.keys(await readVotes())).toHaveLength(9);
  });

  it("finds a município with a durable tree but no index slot", async () => {
    const orphan = resolution(`${CODE}-2025-p1-r001`, "2025-06-01", {
      named: 2,
    });
    await putDurable(orphan);
    // The index knows nothing about TST01.
    await writeFile(
      join(dir, "index.json"),
      JSON.stringify({
        source: "t",
        indexName: "t",
        tags: {},
        resolutionsByObshtina: {},
      }),
      "utf8",
    );

    const r = await writer.rebuildShardsFromDurable();
    expect(r.resolutionsWithVotes).toBe(1);
  });

  it("does not rewrite index.json on a no-op repair", async () => {
    await seedHistory(4);
    await writer.rebuildShardsFromDurable();
    const before = await readFile(join(dir, "index.json"), "utf8");

    await writer.rebuildShardsFromDurable();

    expect(await readFile(join(dir, "index.json"), "utf8")).toBe(before);
  });
});
