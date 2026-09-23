import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFilterIndex, type FilterIndexClient } from "./data";
import { QUERY_VERSION, type FilterRow } from "./storyQuery";

/**
 * ⚠️ THIS HOOK OWNS THE CONTRACT REFUSAL, AND IT SHIPPED WITHOUT A TEST.
 *
 * The refusal was written twice — here by nulling `data`, and again in
 * `useGlobalStoryQuery` by raising an error from `index.data`. The second
 * could not observe what the first rejected, so a manifest from a newer
 * contract produced `{ready: false, loading: false, error: null}`, which the
 * screens' own state machine reads as "loading": a spinner that never
 * resolves, on `/stories`, `/outlet/:domain` and the home chips, with nothing
 * anywhere saying why. Nothing in the suite could see it.
 */

const NOW = Date.parse("2026-09-22T12:00:00Z");
const day = (n: number) =>
  new Date(NOW - n * 86_400_000).toISOString().slice(0, 10) + "T00:00:00Z";

const row = (id: string, published: string): FilterRow =>
  [id, published, ["politics"], ["a.bg"]] as unknown as FilterRow;

const shard = (
  n: number,
  rows: FilterRow[],
  over: Record<string, unknown> = {},
) => ({
  path: `stories/filter-index-${n}.json`,
  count: rows.length,
  newest: rows.length ? String(rows[0][1]) : null,
  oldest: rows.length ? String(rows[rows.length - 1][1]) : null,
  undated: 0,
  ...over,
});

/**
 * A client whose `fetchData` answers from a fixed tree. Returned with the
 * mock so a test can assert WHICH shards were asked for — the property the
 * whole partition exists for.
 */
const clientFor = (tree: Record<string, unknown>) => {
  const fetchData = vi.fn((path: string) => {
    const body = tree[path];
    return body === undefined
      ? Promise.reject(new Error(`404 ${path}`))
      : body instanceof Error
        ? Promise.reject(body)
        : Promise.resolve(body);
  });
  return { client: { fetchData } as unknown as FilterIndexClient, fetchData };
};

const manifest = (
  shards: ReturnType<typeof shard>[],
  version = QUERY_VERSION,
) => ({
  query_version: version,
  generated_at: "2026-09-22T12:00:00Z",
  total: shards.reduce((sum, s) => sum + s.count, 0),
  facets: { categories: {}, domains: {} },
  facets_basis: "whole_corpus",
  shards,
});

const shardBody = (rows: FilterRow[], version = QUERY_VERSION) => ({
  query_version: version,
  stories: rows,
});

describe("useFilterIndex", () => {
  it("REFUSES a manifest from a newer contract as an ERROR, not a spinner", async () => {
    // ⚠️ The regression this pins. Nulling `data` without setting `error`
    // renders listState() === "loading" for ever; a refusal must be
    // distinguishable from "we have not looked yet".
    const { client } = clientFor({
      "/stories/filter-index.json": manifest(
        [shard(1, [row("s1", day(0))])],
        QUERY_VERSION + 1,
      ),
    });
    const { result } = renderHook(() => useFilterIndex(1, NOW, client));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(String(result.current.error)).toContain("query_version");
  });

  it("fetches ONLY the shards the window needs", async () => {
    const { client, fetchData } = clientFor({
      "/stories/filter-index.json": manifest([
        shard(1, [row("new", day(0))]),
        shard(2, [row("old", day(90))]),
      ]),
      "/stories/filter-index-1.json": shardBody([row("new", day(0))]),
      "/stories/filter-index-2.json": shardBody([row("old", day(90))]),
    });
    const { result } = renderHook(() => useFilterIndex(7, NOW, client));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data?.stories).toHaveLength(1);
    const asked = fetchData.mock.calls.map(([path]) => path);
    expect(asked).toContain("/stories/filter-index-1.json");
    expect(asked).not.toContain("/stories/filter-index-2.json");
  });

  it("reads every shard when the query has no window", async () => {
    const { client, fetchData } = clientFor({
      "/stories/filter-index.json": manifest([
        shard(1, [row("new", day(0))]),
        shard(2, [row("old", day(90))]),
      ]),
      "/stories/filter-index-1.json": shardBody([row("new", day(0))]),
      "/stories/filter-index-2.json": shardBody([row("old", day(90))]),
    });
    const { result } = renderHook(() => useFilterIndex(0, NOW, client));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data?.stories).toHaveLength(2);
    expect(fetchData.mock.calls.map(([p]) => p)).toContain(
      "/stories/filter-index-2.json",
    );
  });

  it("keeps the rows it has while a widened window loads", async () => {
    // ⚠️ Blanking drops `ready` to false, which the screens read as
    // "loading" — the counts and the list vanish and come back on a widened
    // window, which before the partition needed no fetch at all.
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const { client } = clientFor({
      "/stories/filter-index.json": manifest([
        shard(1, [row("new", day(0))]),
        shard(2, [row("old", day(90))]),
      ]),
      "/stories/filter-index-1.json": shardBody([row("new", day(0))]),
      "/stories/filter-index-2.json": pending,
    });
    const { result, rerender } = renderHook(
      ({ days }: { days: number }) => useFilterIndex(days, NOW, client),
      { initialProps: { days: 7 } },
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    rerender({ days: 0 });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.data?.stories).toHaveLength(1);
    release(shardBody([row("old", day(90))]));
    await waitFor(() => expect(result.current.data?.stories).toHaveLength(2));
  });

  it("refuses a shard whose row count disagrees with the manifest", async () => {
    // ⚠️ A short shard is a FAILURE, not a smaller corpus: a facet reading
    // „2" beside a list of nine is the single defect this index removes.
    const { client } = clientFor({
      "/stories/filter-index.json": manifest([
        shard(1, [row("a", day(0)), row("b", day(1))]),
      ]),
      "/stories/filter-index-1.json": shardBody([row("a", day(0))]),
    });
    const { result } = renderHook(() => useFilterIndex(7, NOW, client));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBeNull();
    expect(String(result.current.error)).toContain("manifest declares 2");
  });

  it("refuses a shard written under another contract", async () => {
    const { client } = clientFor({
      "/stories/filter-index.json": manifest([shard(1, [row("a", day(0))])]),
      "/stories/filter-index-1.json": shardBody(
        [row("a", day(0))],
        QUERY_VERSION + 1,
      ),
    });
    const { result } = renderHook(() => useFilterIndex(7, NOW, client));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(String(result.current.error)).toContain("shard query_version");
  });

  it("retries a failed shard fetch rather than staying dead for the release", async () => {
    // ⚠️ Under a publication manifest the base fetch is PINNED, so the
    // manifest object never changes identity and the effect would never
    // re-run: one transient 502 disabled every facet count until the next
    // release, with no way back.
    let attempt = 0;
    const fetchData = vi.fn((path: string) => {
      if (path === "/stories/filter-index.json")
        return Promise.resolve(manifest([shard(1, [row("a", day(0))])]));
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error("502"))
        : Promise.resolve(shardBody([row("a", day(0))]));
    });
    const client = { fetchData } as unknown as FilterIndexClient;
    const { result } = renderHook(() => useFilterIndex(7, NOW, client));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBeNull();
    result.current.retry();
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.error).toBeNull();
    expect(result.current.data?.stories).toHaveLength(1);
  });

  it("answers an empty corpus without fetching a shard", async () => {
    const { client, fetchData } = clientFor({
      "/stories/filter-index.json": manifest([]),
    });
    const { result } = renderHook(() => useFilterIndex(7, NOW, client));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data?.stories).toEqual([]);
    expect(
      fetchData.mock.calls.filter(([p]) => p.includes("filter-index-")),
    ).toHaveLength(0);
  });
});
