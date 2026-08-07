import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  walkIndex,
  fetchKeepJson,
  NotFoundError,
  indexPageUrl,
  projectDetailUrl,
  programmeDetailUrl,
  INDEX_PAGE_SIZE,
  MAX_CONCURRENCY,
  fetchDetails,
  cachedKeepIds,
  readCachedDetail,
  type Fetcher,
  type KeepIndexPage,
} from "./keep_fetch";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * A fake keep.eu index: `count` projects, id-descending, 6 per page, each
 * tagged with a programme id drawn from `programmeIds` round-robin.
 *
 * 342 = Romania-Bulgaria 21-27 (admitted); 339 = Romania-Moldova (not ours).
 */
const fakeIndex = (
  ids: { id: number; programmeId: number | null }[],
  opts: { failOn?: number[] } = {},
): { fetcher: Fetcher; calls: string[] } => {
  const calls: string[] = [];
  const failOn = new Set(opts.failOn ?? []);
  const pages: KeepIndexPage[] = [];
  for (let i = 0; i < ids.length; i += INDEX_PAGE_SIZE) {
    pages.push({
      count: ids.length,
      total_pages: Math.ceil(ids.length / INDEX_PAGE_SIZE),
      results: ids.slice(i, i + INDEX_PAGE_SIZE).map((r) => ({
        id: r.id,
        programme: r.programmeId === null ? null : { id: r.programmeId },
      })),
    });
  }
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 1);
    if (failOn.has(page)) return json({}, 503);
    return json(pages[page - 1] ?? { count: 0, total_pages: 0, results: [] });
  };
  return { fetcher, calls };
};

/** Descending ids, alternating between an admitted and an unadmitted programme. */
const descending = (
  from: number,
  n: number,
): { id: number; programmeId: number }[] =>
  Array.from({ length: n }, (_, i) => ({
    id: from - i,
    programmeId: i % 2 === 0 ? 342 : 339,
  }));

describe("url builders", () => {
  it("names the three public endpoints", () => {
    expect(indexPageUrl(7)).toBe("https://keep.eu/api/search/projects/?page=7");
    expect(projectDetailUrl(34025)).toBe("https://keep.eu/api/project/34025/");
    expect(programmeDetailUrl(342)).toBe("https://keep.eu/api/programme/342/");
  });
});

describe("fetchKeepJson", () => {
  it("returns the parsed body on success", async () => {
    const fetcher = vi.fn<Fetcher>(async () => json({ ok: 1 }));
    await expect(fetchKeepJson<{ ok: number }>("u", fetcher)).resolves.toEqual({
      ok: 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  // A 404 is a real answer about a real id — keep.eu's project ids are not
  // contiguous — so retrying it just burns the budget three times over.
  it("does not retry a 404, and marks it so a crawl can record and continue", async () => {
    const fetcher = vi.fn<Fetcher>(async () => json({}, 404));
    await expect(fetchKeepJson("u", fetcher)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 4xx that is not rate limiting", async () => {
    const fetcher = vi.fn<Fetcher>(async () => json({}, 400));
    await expect(fetchKeepJson("u", fetcher)).rejects.toThrow(/400/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and a 5xx, then succeeds", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const fetcher: Fetcher = async () => {
        n++;
        if (n === 1) return json({}, 429);
        if (n === 2) return json({}, 503);
        return json({ ok: true });
      };
      const p = fetchKeepJson<{ ok: boolean }>("u", fetcher);
      await vi.runAllTimersAsync();
      await expect(p).resolves.toEqual({ ok: true });
      expect(n).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after the backoff schedule and reports the last failure", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<Fetcher>(async () => json({}, 500));
      const p = fetchKeepJson("u", fetcher);
      const assertion = expect(p).rejects.toThrow(/500/);
      await vi.runAllTimersAsync();
      await assertion;
      // one initial attempt + three backoff retries
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("walkIndex", () => {
  it("keeps only rows whose programme is in the curated register", async () => {
    const { fetcher } = fakeIndex(descending(1000, 12));
    const { rows, total } = await walkIndex({ fetcher });
    expect(total).toBe(12);
    // 6 of the 12 carry programme 342; the other 6 carry 339, which is real on
    // keep.eu and has no Bulgarian participation.
    expect(rows.length).toBe(6);
    expect(new Set(rows.map((r) => r.keepProgrammeId))).toEqual(new Set([342]));
    expect(rows[0].programmeCode).toBe("INTERREG-ROBG-2127");
  });

  it("drops a row with no programme rather than throwing", async () => {
    const { fetcher } = fakeIndex([
      { id: 9, programmeId: 342 },
      { id: 8, programmeId: null },
      { id: 7, programmeId: 342 },
    ]);
    const { rows } = await walkIndex({ fetcher });
    expect(rows.map((r) => r.keepId)).toEqual([9, 7]);
  });

  it("stops once a page reaches an id already held", async () => {
    // 60 ids descending from 1000 → 941, i.e. 10 pages.
    const { fetcher, calls } = fakeIndex(descending(1000, 60));
    const { rows, pagesFetched } = await walkIndex({
      fetcher,
      stopAtKeepId: 980,
      concurrency: 1,
    });
    // Everything at or below 980 is already held.
    expect(Math.min(...rows.map((r) => r.keepId))).toBeGreaterThan(980);
    // Exactly 4: ids 1000→941 at 6/page, so page 4 spans 982-977 and is the
    // first to contain 980. `toBeLessThan(10)` would not notice the stop
    // condition firing a whole wave late.
    expect(pagesFetched).toBe(4);
    expect(calls.length).toBe(pagesFetched);
  });

  it("never returns a row at or below the stop id, even mid-page", async () => {
    const { fetcher } = fakeIndex(descending(1000, 60));
    const { rows } = await walkIndex({ fetcher, stopAtKeepId: 995 });
    expect(rows.every((r) => r.keepId > 995)).toBe(true);
  });

  // With requests in flight it is otherwise possible to stop on page N while
  // page N-1 is unresolved, silently dropping its rows.
  it("evaluates the stop condition against a whole wave, losing no page", async () => {
    const { fetcher } = fakeIndex(descending(1000, 120));
    const wave = await walkIndex({
      fetcher,
      stopAtKeepId: 900,
      concurrency: 8,
    });
    const serial = await walkIndex({
      fetcher,
      stopAtKeepId: 900,
      concurrency: 1,
    });
    // Numeric sort: the default is lexicographic, which would order
    // [1000, 999, 99] as [1000, 99, 999] — a latent trap even when both sides
    // happen to agree.
    const num = (a: number, b: number) => a - b;
    expect(wave.rows.map((r) => r.keepId).sort(num)).toEqual(
      serial.rows.map((r) => r.keepId).sort(num),
    );
  });

  it("walks the whole index when no stop id is given", async () => {
    const { fetcher, calls } = fakeIndex(descending(1000, 60));
    const { rows, pagesFetched } = await walkIndex({ fetcher, concurrency: 4 });
    expect(pagesFetched).toBe(10);
    expect(calls.length).toBe(10);
    expect(rows.length).toBe(30);
  });

  it("honours a page cap for a smoke run", async () => {
    const { fetcher } = fakeIndex(descending(1000, 60));
    const { pagesFetched } = await walkIndex({
      fetcher,
      maxPages: 3,
      concurrency: 2,
    });
    expect(pagesFetched).toBe(3);
  });

  it("de-duplicates an id served on two pages", async () => {
    const { fetcher } = fakeIndex([
      { id: 9, programmeId: 342 },
      { id: 9, programmeId: 342 },
      { id: 8, programmeId: 342 },
    ]);
    const { rows } = await walkIndex({ fetcher });
    expect(rows.map((r) => r.keepId)).toEqual([9, 8]);
  });

  it("reports progress against the real page total", async () => {
    const { fetcher } = fakeIndex(descending(1000, 60));
    const seen: [number, number][] = [];
    await walkIndex({
      fetcher,
      concurrency: 4,
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen.at(-1)).toEqual([10, 10]);
  });

  it("keeps the concurrency ceiling modest — keep.eu is a secretariat, not a CDN", () => {
    expect(MAX_CONCURRENCY).toBeLessThanOrEqual(8);
  });
});

describe("fetchDetails", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "interreg-cache-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const idOf = (url: string): number => Number(/project\/(\d+)/.exec(url)![1]);
  const ok: Fetcher = async (url) => json({ id: idOf(url) });
  const statusFor =
    (bad: number, status: number): Fetcher =>
    async (url) =>
      idOf(url) === bad ? json({}, status) : json({ id: idOf(url) });

  it("hands each id to exactly one worker", async () => {
    const seen: number[] = [];
    const fetcher: Fetcher = async (url) => {
      seen.push(idOf(url));
      return json({ id: idOf(url) });
    };
    const res = await fetchDetails([1, 2, 3, 4, 5], {
      fetcher,
      concurrency: 3,
      dir,
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(res.fetched).toBe(5);
    expect(cachedKeepIds(dir)).toEqual([1, 2, 3, 4, 5]);
  });

  it("records a 404 as missing and keeps going", async () => {
    const res = await fetchDetails([1, 2, 3], {
      fetcher: statusFor(2, 404),
      dir,
    });
    expect(res.fetched).toBe(2);
    expect(res.missing).toEqual([2]);
    expect(cachedKeepIds(dir)).toEqual([1, 3]);
  });

  // Throwing here would discard the run report while the other, uncancelled
  // workers kept writing — leaving a cache the operator cannot characterise.
  it("does not lose the run report when one id fails hard", async () => {
    const res = await fetchDetails([1, 2, 3], {
      fetcher: statusFor(2, 400),
      dir,
    });
    expect(res.fetched).toBe(2);
    expect(res.failed.map((f) => f.keepId)).toEqual([2]);
    expect(cachedKeepIds(dir)).toEqual([1, 3]);
  });

  it("skips ids already cached, and re-fetches them under force", async () => {
    await fetchDetails([1, 2], { fetcher: ok, dir });
    const again = await fetchDetails([1, 2, 3], { fetcher: ok, dir });
    expect(again).toMatchObject({ fetched: 1, skipped: 2 });
    const forced = await fetchDetails([1, 2, 3], {
      fetcher: ok,
      dir,
      force: true,
    });
    expect(forced).toMatchObject({ fetched: 3, skipped: 0 });
  });

  it("rejects a non-positive concurrency instead of spawning zero workers", async () => {
    await expect(
      fetchDetails([1], { fetcher: ok, dir, concurrency: 0 }),
    ).rejects.toThrow(/positive integer/);
    await expect(
      fetchDetails([1], { fetcher: ok, dir, concurrency: Number.NaN }),
    ).rejects.toThrow(/positive integer/);
  });
});

describe("the raw cache", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "interreg-cache-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("treats a truncated cache file as absent rather than throwing", () => {
    fs.writeFileSync(path.join(dir, "7.json"), '{"id": 7, "partner');
    expect(readCachedDetail(7, dir)).toBeNull();
  });

  // The regex anchor is what keeps a killed crawl's temp files out of the
  // resume set; an endsWith(".json") refactor would break this silently.
  it("ignores orphaned .tmp files left by a killed crawl", () => {
    fs.writeFileSync(path.join(dir, "8.json.tmp"), "{}");
    fs.writeFileSync(path.join(dir, "9.json"), "{}");
    expect(cachedKeepIds(dir)).toEqual([9]);
  });

  it("returns an empty list for a cache directory that does not exist", () => {
    expect(cachedKeepIds(path.join(dir, "nope"))).toEqual([]);
  });
});

describe("walkIndex — surviving a ~2 h unattended run", () => {
  // FINDING-001: a bare Promise.all rejected the wave, unwound the walk and
  // discarded every row already collected.
  it("does not discard the pages already walked because one page failed", async () => {
    vi.useFakeTimers();
    try {
      const { fetcher } = fakeIndex(descending(1000, 120), { failOn: [7] });
      const p = walkIndex({ fetcher, concurrency: 8 });
      await vi.runAllTimersAsync();
      const walk = await p;
      expect(walk.rows.length).toBeGreaterThan(0);
      expect(walk.failedPages).toEqual([7]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a failed page once and clears it when the retry succeeds", async () => {
    let firstTry = true;
    const { fetcher: base } = fakeIndex(descending(1000, 60));
    const fetcher: Fetcher = async (url) => {
      if (/page=5(&|$)/.test(url) && firstTry) {
        firstTry = false;
        return json({}, 503);
      }
      return base(url);
    };
    vi.useFakeTimers();
    try {
      const p = walkIndex({ fetcher, concurrency: 4 });
      await vi.runAllTimersAsync();
      const walk = await p;
      expect(walk.failedPages).toEqual([]);
      expect(walk.rows.length).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });

  it("checkpoints after every wave so a crash costs one wave, not the walk", async () => {
    const { fetcher } = fakeIndex(descending(1000, 120));
    const checkpoints: number[] = [];
    await walkIndex({
      fetcher,
      concurrency: 4,
      onCheckpoint: (rows) => checkpoints.push(rows.length),
    });
    expect(checkpoints.length).toBeGreaterThan(1);
    // Monotonic: a checkpoint never sees fewer rows than the one before it.
    expect(checkpoints).toEqual([...checkpoints].sort((a, b) => a - b));
    expect(checkpoints.at(-1)).toBe(60);
  });

  // FINDING-004: the index is live. A project inserted at the top mid-walk
  // shifts every later page down by one row and exactly one row is never
  // served to us — invisible to `seen`, which only catches repeats. Total
  // drift is what detects it; id-contiguity CANNOT, because keep.eu ids are
  // sparse (32,702 projects, max id 34,025).
  it("notices when the index total moves under the walk", async () => {
    const { fetcher: base } = fakeIndex(descending(1000, 60));
    const fetcher: Fetcher = async (url) => {
      const res = await base(url);
      const body = (await res.json()) as KeepIndexPage;
      const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? 1);
      // Somebody inserts a project at the top while we are on page 5.
      if (page >= 5) body.count += 1;
      return json(body);
    };
    const walk = await walkIndex({ fetcher, concurrency: 4 });
    expect(walk.indexShifted).toBe(true);
    expect(walk.countAtEnd).toBe(walk.countAtStart + 1);
  });

  it("reports a stable index as unshifted", async () => {
    const { fetcher } = fakeIndex(descending(1000, 60));
    const walk = await walkIndex({ fetcher, concurrency: 8 });
    expect(walk.indexShifted).toBe(false);
    expect(walk.countAtStart).toBe(walk.countAtEnd);
  });

  // Sparse ids are the norm, not a symptom. This is the false positive the
  // boundary-arithmetic check would have produced on every real walk.
  it("does not call a sparse id range a shift", async () => {
    const sparse = [1000, 998, 991, 940, 900, 880, 700, 690, 12, 3].map(
      (id, i) => ({ id, programmeId: i % 2 === 0 ? 342 : 339 }),
    );
    const { fetcher } = fakeIndex(sparse);
    const walk = await walkIndex({ fetcher, concurrency: 4 });
    expect(walk.indexShifted).toBe(false);
  });

  it("rejects a non-positive concurrency rather than spinning forever", async () => {
    const { fetcher } = fakeIndex(descending(1000, 12));
    await expect(walkIndex({ fetcher, concurrency: 0 })).rejects.toThrow(
      /positive integer/,
    );
    await expect(
      walkIndex({ fetcher, concurrency: Number.NaN }),
    ).rejects.toThrow(/positive integer/);
    await expect(walkIndex({ fetcher, maxPages: Number.NaN })).rejects.toThrow(
      /positive integer/,
    );
  });

  it("retries a 200 carrying a non-JSON body, then names the cause", async () => {
    vi.useFakeTimers();
    try {
      const fetcher: Fetcher = async () =>
        new Response("<html>maintenance</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      const p = fetchKeepJson("u", fetcher);
      const assertion = expect(p).rejects.toThrow(/non-JSON body/);
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
