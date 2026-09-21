import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDataClient, useStoryList, type StoryIndexPage } from "./data";

/**
 * `useStoryList` rendered against a fake client — the two rules the pure
 * `storyListView` tests cannot see, because both are about WHICH page is
 * fetched and WHEN it is merged:
 *
 *   - a sort switch fetches by the REVEALED sort, so a cached page N of the
 *     new ordering cannot land in the emptied map ahead of page 1;
 *   - `loadMore` never advances from a page that did not arrive, so a
 *     failed page is retried in place rather than stepped over.
 */

const page = (
  prefix: "index" | "ranked",
  n: number,
  pages: number,
): StoryIndexPage => ({
  generated_at: "2026-09-21T11:00:00Z",
  as_of: "2026-09-21T11:00:00Z",
  sort: prefix === "ranked" ? "prominence" : "latest",
  stale_ranking: false,
  page: n,
  pages,
  page_size: 2,
  total: pages * 2,
  stories: [0, 1].map((i) => ({
    id: `${prefix}-${n}-${i}`,
    title_bg: null,
    title_en: null,
    topics: [],
    first_published: `2026-09-${String(20 - n).padStart(2, "0")}T0${i}:00:00Z`,
    last_published: `2026-09-${String(20 - n).padStart(2, "0")}T0${i}:00:00Z`,
    member_count: 1,
    domains: ["a.bg"],
    prominence: {
      version: 1,
      score: 10 - n - i * 0.1,
      outlets: 1,
      articles: 1,
      arriving: 0,
      age_hours: 1,
      publication_time_known: true,
    },
  })),
});

const ok = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const fail = () => Promise.resolve(new Response("{}", { status: 502 }));

const clientWith = (answer: (path: string) => Promise<Response>) => {
  const fetcher = vi.fn((input: RequestInfo | URL) => answer(String(input)));
  const client = createDataClient("/news-data", {
    usePublicationManifest: false,
    fetcher: fetcher as unknown as typeof fetch,
  });
  return { client, fetcher };
};

const requested = (fetcher: ReturnType<typeof vi.fn>) =>
  fetcher.mock.calls.map((call) =>
    String(call[0]).replace(/^.*\/stories\//, ""),
  );

afterEach(() => vi.restoreAllMocks());

describe("useStoryList against a client", () => {
  it("fetches a sort switch by the REVEALED sort and refuses the other ordering's page", async () => {
    // ⚠️ THE MUTATION THIS CATCHES: `useStoryIndexPage(page, sort)` with the
    // requested sort. The path then moves one effect before the reset to
    // page 1, and `ranked-3` — already in the promise cache — would land in
    // the emptied map ahead of `ranked-1`.
    const { client, fetcher } = clientWith((path) => {
      const m = /stories\/(index|ranked)-(\d)\.json$/.exec(path);
      if (!m) return fail();
      return ok(page(m[1] as "index" | "ranked", Number(m[2]), 3));
    });
    // Warm the cache with ranked-3, as a reader who browsed ranked to page
    // 3 earlier in the session would have.
    await client.fetchData("/stories/ranked-3.json");
    // ⚠️ Observed at the CLIENT, not at the fetcher: a cached page is served
    // without a network call, so the fetcher cannot see the hook asking for
    // it — which is exactly how the race hides.
    const asked = vi.fn(client.fetchData);
    const observed = { ...client, fetchData: asked as typeof client.fetchData };

    const hook = renderHook(({ sort }) => useStoryList(sort, observed), {
      initialProps: { sort: "latest" as "latest" | "ranked" },
    });
    await waitFor(() => expect(hook.result.current.stories).toHaveLength(2));
    act(() => hook.result.current.loadMore());
    await waitFor(() => expect(hook.result.current.stories).toHaveLength(4));
    act(() => hook.result.current.loadMore());
    await waitFor(() => expect(hook.result.current.stories).toHaveLength(6));

    hook.rerender({ sort: "ranked" });
    await waitFor(() =>
      expect(hook.result.current.stories.map((s) => s.id)).toEqual([
        "ranked-1-0",
        "ranked-1-1",
      ]),
    );
    expect(hook.result.current.sort).toBe("ranked");
    expect(hook.result.current.hasMore).toBe(true);
    // Never asked for the other ordering's page 3 on the reader's behalf —
    // neither from the network nor from the cache.
    expect(requested(fetcher).filter((p) => p === "ranked-3.json")).toEqual([
      "ranked-3.json",
    ]);
    expect(asked.mock.calls.map((call) => String(call[0]))).not.toContain(
      "/stories/ranked-3.json",
    );
    expect(requested(fetcher).at(-1)).toBe("ranked-1.json");
  });

  it("does not merge a page whose own sort is not the ordering being revealed", async () => {
    // Provenance, independent of the path: a page carrying `sort:
    // "prominence"` served where `latest` was asked for is refused.
    const { client } = clientWith((path) =>
      /index-1\.json$/.test(path)
        ? ok({ ...page("ranked", 1, 1), sort: "prominence" })
        : fail(),
    );
    const hook = renderHook(() => useStoryList("latest", client));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.stories).toEqual([]);
  });

  it("refuses to advance from a page that never landed, and retries it in place", async () => {
    // ⚠️ THE MUTATION THIS CATCHES: `loadMore` advancing on `pageCount`
    // alone. `useData` keeps page 1 beside the error, `hasMore` is still
    // true, and a second `loadMore` would ask for page 3 — leaving page 2
    // as a hole in a list that calls itself a prefix.
    let broken = true;
    const { client, fetcher } = clientWith((path) => {
      const m = /stories\/index-(\d)\.json$/.exec(path);
      if (!m) return fail();
      if (m[1] === "2" && broken) return fail();
      return ok(page("index", Number(m[1]), 3));
    });
    const hook = renderHook(() => useStoryList("latest", client));
    await waitFor(() => expect(hook.result.current.stories).toHaveLength(2));
    act(() => hook.result.current.loadMore());
    await waitFor(() => expect(hook.result.current.error).not.toBeNull());
    expect(hook.result.current.stories).toHaveLength(2);
    expect(hook.result.current.hasMore).toBe(true);

    act(() => hook.result.current.loadMore());
    await act(async () => Promise.resolve());
    expect(requested(fetcher)).not.toContain("index-3.json");

    broken = false;
    act(() => hook.result.current.retry());
    await waitFor(() => expect(hook.result.current.stories).toHaveLength(4));
    expect(hook.result.current.error).toBeNull();
    expect(requested(fetcher).filter((p) => p === "index-2.json")).toHaveLength(
      2,
    );
  });
});
