import { act, renderHook, waitFor } from "@testing-library/react";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDataClient,
  DATA_REFRESH_MS,
  parseOutletArticlesBundle,
  PUBLICATION_POLL_MS,
  useDataWithClient,
  useStoryTitles,
} from "./data";

// A REAL `Response`, not a `{ json }` fake: the client now reads bytes
// (`arrayBuffer`) to verify them against the manifest, so a fake that only
// answered `json()` would fail every fetch for a reason unrelated to the
// test.
const response = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

/**
 * The manifest's description of one published body — TRUTHFUL, because the
 * client verifies every listed payload against it (T1.5). A manifest that
 * listed `home.json` as 2 bytes of `b…` beside a served `{source:"one"}`
 * was fine while nothing checked; now it is a refused release.
 */
const listed = (path: string, body: unknown) => {
  const bytes = Buffer.from(JSON.stringify(body));
  return {
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};

const manifest = (
  runId: string,
  files: Record<string, unknown> = { "home.json": { source: "base" } },
) => {
  const inventory = Object.entries(files).map(([path, body]) =>
    listed(path, body),
  );
  return {
    version: 3,
    run_id: runId,
    generated_at: "2026-08-31T07:00:00Z",
    data_base: `versions/${runId}`,
    home_health_ready: true,
    accepted_snapshot_records_sha256: null,
    accepted_feedback_records_sha256: null,
    bundle: {
      sha256: "a".repeat(64),
      files: inventory.length,
      bytes: inventory.reduce((total, file) => total + file.bytes, 0),
      inventory,
    },
  };
};

describe("versioned news data client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("moves to a new complete version after the manifest changes", async () => {
    let clock = 0;
    let current = "run-1";
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const source = (runId: string) => ({
        source: runId === "run-1" ? "one" : "two",
      });
      if (url.endsWith("/manifest.json"))
        return response(manifest(current, { "home.json": source(current) }));
      return response(source(url.includes("run-1") ? "run-1" : "run-2"));
    });
    const client = createDataClient("https://data.example/news", {
      now: () => clock,
      fetcher: fetcher as unknown as typeof fetch,
    });

    await expect(
      client.fetchData<{ source: string }>("/home.json"),
    ).resolves.toEqual({ source: "one" });
    current = "run-2";
    clock = 61_000;
    await expect(
      client.fetchData<{ source: string }>("/home.json"),
    ).resolves.toEqual({ source: "two" });

    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://data.example/news/manifest.json",
      "https://data.example/news/versions/run-1/home.json",
      "https://data.example/news/manifest.json",
      "https://data.example/news/versions/run-2/home.json",
    ]);
  });

  it("accepts a legacy v1 pointer but rejects an invalid v2 accepted-snapshot hash", async () => {
    const legacy = {
      ...manifest("legacy", { "home.json": { ok: true } }),
      version: 1,
    } as Record<string, unknown>;
    delete legacy.accepted_snapshot_records_sha256;
    delete legacy.accepted_feedback_records_sha256;
    const legacyClient = createDataClient("https://data.example/news", {
      fetcher: vi
        .fn()
        .mockResolvedValueOnce(await response(legacy))
        .mockResolvedValueOnce(
          await response({ ok: true }),
        ) as unknown as typeof fetch,
    });
    await expect(legacyClient.fetchData("/home.json")).resolves.toEqual({
      ok: true,
    });

    const invalidClient = createDataClient("https://data.example/news", {
      fetcher: vi.fn(() =>
        response({
          ...manifest("bad-hash"),
          accepted_snapshot_records_sha256: "not-a-hash",
        }),
      ) as unknown as typeof fetch,
    });
    await expect(invalidClient.fetchData("/home.json")).rejects.toThrow(
      "invalid or unsafe release pointer",
    );
  });

  it("deduplicates concurrent bundle requests within one version", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/manifest.json")
        ? response(manifest("same-run", { "home.json": { ok: true } }))
        : response({ ok: true }),
    );
    const client = createDataClient("https://data.example/news", {
      fetcher: fetcher as unknown as typeof fetch,
    });

    const [first, second] = await Promise.all([
      client.fetchData("/home.json"),
      client.fetchData("/home.json"),
    ]);
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects an unsafe pointer before requesting a bundle", async () => {
    const fetcher = vi.fn(() =>
      response({
        ...manifest("safe-run"),
        data_base: "../partial",
      }),
    );
    const client = createDataClient("https://data.example/news", {
      fetcher: fetcher as unknown as typeof fetch,
    });

    await expect(client.fetchData("/home.json")).rejects.toThrow(
      "invalid or unsafe release pointer",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["2026-08-31", "2026-08-31T07:00:00", "not-a-date"])(
    "rejects a non-instant manifest timestamp: %s",
    async (generatedAt) => {
      const fetcher = vi.fn(() =>
        response({ ...manifest("safe-run"), generated_at: generatedAt }),
      );
      const client = createDataClient("https://data.example/news", {
        fetcher: fetcher as unknown as typeof fetch,
      });
      await expect(client.fetchData("/home.json")).rejects.toThrow(
        "invalid or unsafe release pointer",
      );
    },
  );

  it("keeps the last complete version when manifest refresh fails", async () => {
    let clock = 0;
    let failManifest = false;
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/manifest.json")) {
        return failManifest
          ? response({}, 503)
          : response(manifest("stable", { "home.json": { stable: true } }));
      }
      return response({ stable: true });
    });
    const client = createDataClient("https://data.example/news", {
      now: () => clock,
      fetcher: fetcher as unknown as typeof fetch,
    });

    await client.fetchData("/home.json");
    failManifest = true;
    clock = 301_000;
    await expect(client.fetchData("/home.json")).resolves.toEqual({
      stable: true,
    });
    // ⚠️ ONCE, not twice — and this assertion used to say the opposite.
    // It required the base to be re-fetched after 301 s, which was true
    // only because of a blanket 5-minute cache expiry that has since been
    // removed: the key contains `versions/<run_id>`, so the URL is
    // immutable and a second download returns the identical bytes. Under
    // a 5-minute hot cadence that expiry re-downloaded the whole base on
    // the same schedule as the overlay, which would have made the overlay
    // buy nothing while every test still passed. What this test is about
    // — a warm reader keeps serving the last complete version when the
    // pointer cannot be refreshed — is the `resolves` above.
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith("/versions/stable/home.json"),
      ),
    ).toHaveLength(1);
  });

  it("can bypass manifests for the bundled local development data", async () => {
    const fetcher = vi.fn(() => response({ local: true }));
    const client = createDataClient("/news-data", {
      usePublicationManifest: false,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await client.fetchData("/home.json");
    expect(fetcher).toHaveBeenCalledWith("/news-data/home.json", {
      cache: "force-cache",
    });
  });

  it("does not let a late older response replace a newer hook result", async () => {
    vi.useFakeTimers();
    let resolveOld!: (value: Response) => void;
    let resolveNew!: (value: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const newResponse = new Promise<Response>((resolve) => {
      resolveNew = resolve;
    });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => oldResponse)
      .mockImplementationOnce(() => newResponse);
    const client = createDataClient("/news-data", {
      usePublicationManifest: false,
      fetcher: fetcher as unknown as typeof fetch,
    });
    const hook = renderHook(() =>
      useDataWithClient<{ value: string }>("/home.json", client),
    );
    await act(async () => Promise.resolve());
    expect(fetcher).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(DATA_REFRESH_MS);
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveNew(new Response(JSON.stringify({ value: "new" })));
      await Promise.resolve();
    });
    expect(hook.result.current.data).toEqual({ value: "new" });

    await act(async () => {
      resolveOld(new Response(JSON.stringify({ value: "old" })));
      await Promise.resolve();
    });
    expect(hook.result.current.data).toEqual({ value: "new" });
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not poll while the tab is hidden and refreshes once when shown", async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "visible";
    // An own property shadows Document.prototype's getter; deleting it in
    // `finally` restores jsdom's default for every later test.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    // One client object for every render: the hook's effect depends on it.
    const fetchData = vi.fn(async () => ({ value: "x" }));
    const client = { fetchData } as unknown as Parameters<
      typeof useDataWithClient
    >[1];
    const hook = renderHook(() =>
      useDataWithClient<{ value: string }>("/home.json", client),
    );
    try {
      await act(async () => Promise.resolve());
      expect(fetchData).toHaveBeenCalledTimes(1);

      // Going hidden fetches nothing, and neither do ticks while hidden.
      visibility = "hidden";
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        vi.advanceTimersByTime(PUBLICATION_POLL_MS * 5);
        await Promise.resolve();
      });
      expect(fetchData).toHaveBeenCalledTimes(1);

      visibility = "visible";
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
      });
      expect(fetchData).toHaveBeenCalledTimes(2);

      await act(async () => {
        vi.advanceTimersByTime(PUBLICATION_POLL_MS);
        await Promise.resolve();
      });
      expect(fetchData).toHaveBeenCalledTimes(3);
    } finally {
      hook.unmount();
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the previous good data when a refresh parser fails", async () => {
    vi.useFakeTimers();
    let body: unknown = { valid: true, revision: 1 };
    const fetcher = vi.fn(() => response(body));
    const client = createDataClient("/news-data", {
      usePublicationManifest: false,
      fetcher: fetcher as unknown as typeof fetch,
    });
    const parse = (value: unknown) => {
      if (
        !value ||
        typeof value !== "object" ||
        !(value as { valid?: unknown }).valid
      )
        throw new Error("invalid refreshed bundle");
      return value as { valid: true; revision: number };
    };
    const hook = renderHook(() =>
      useDataWithClient("/articles/example.json", client, parse),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.data).toEqual({ valid: true, revision: 1 });

    body = { valid: false, revision: 2 };
    await act(async () => {
      vi.advanceTimersByTime(DATA_REFRESH_MS);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.result.current.data).toEqual({ valid: true, revision: 1 });
    expect(hook.result.current.error?.message).toBe("invalid refreshed bundle");
    hook.unmount();
  });
});

describe("article provenance parsing", () => {
  const bundle = (confidence: number | null, disposition = "changed") => ({
    domain: "example.bg",
    outlet: "Пример",
    generated_at: "2026-08-31T12:00:00Z",
    articles: [
      {
        id: "article-1",
        domain: "example.bg",
        analysis: {
          leaning: { label: "progressive", confidence, evidence: "Основание" },
          russia_stance: {
            label: "not_applicable",
            confidence: 0.8,
            evidence: "Основание",
          },
          party_tones: [],
          human_review: {
            status: "accepted",
            adjudicated_at: "2026-08-31T12:00:00.000Z",
            revision: 1,
            fields: {
              leaning: disposition,
              russia_stance: "unable_to_judge",
              party_tones: "accepted",
            },
            public_explanation: null,
          },
        },
      },
    ],
  });

  it("accepts mixed model/editorial provenance and rejects malformed or contradictory blocks", () => {
    expect(parseOutletArticlesBundle(bundle(null))).toBeTruthy();

    const malformed = bundle(null);
    Reflect.deleteProperty(
      malformed.articles[0].analysis.human_review.fields,
      "leaning",
    );
    expect(() => parseOutletArticlesBundle(malformed)).toThrow(
      /редакционната проверка/,
    );

    expect(() => parseOutletArticlesBundle(bundle(0.9))).toThrow(
      /редакционната проверка/,
    );
    expect(
      parseOutletArticlesBundle(bundle(0.9, "unable_to_judge")),
    ).toBeTruthy();
  });

  it("rejects malformed accepted feedback and unsafe reviewed links", () => {
    const value = bundle(null) as unknown as {
      articles: Array<
        Record<string, unknown> & { analysis: Record<string, unknown> }
      >;
    };
    value.articles[0].editorial_feedback = {
      status: "accepted",
      adjudicated_at: "2026-09-01T10:00:00.000Z",
      revision: 1,
      fields: ["entity_links"],
      needs_revalidation_fields: [],
      issue_kinds: ["missing_entity"],
      public_explanation: null,
    };
    value.articles[0].analysis.reviewed_links = [
      {
        surface: "Иван",
        kind: "person",
        id: "p1",
        canonical: "Иван Иванов",
        href: "https://electionsbg.com/person/p1",
      },
    ];
    expect(parseOutletArticlesBundle(value)).toBeTruthy();

    value.articles[0].analysis.reviewed_links = [
      {
        surface: "Иван",
        kind: "person",
        id: "p1",
        canonical: "Иван Иванов",
        href: "https://evil.example/person/p1",
      },
    ];
    expect(() => parseOutletArticlesBundle(value)).toThrow(
      /проверените връзки/,
    );
    value.articles[0].analysis.reviewed_links = [];
    (
      value.articles[0].editorial_feedback as Record<string, unknown>
    ).source_submission_ids = ["private"];
    expect(() => parseOutletArticlesBundle(value)).toThrow(/обратна връзка/);
  });
});

describe("useStoryTitles", () => {
  /**
   * ⚠️ SavedScreen was the LAST screen downloading the 1,456 KB corpus,
   * and it did so to read a handful of titles. A saved id may sit on any
   * index page, so the paginated index cannot answer it without fetching
   * every page — hence one ~1.4 KB detail file per saved id instead.
   */
  const clientFor = (bodies: Record<string, unknown>) =>
    createDataClient("https://data.example/news", {
      usePublicationManifest: false,
      fetcher: vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        for (const [suffix, body] of Object.entries(bodies)) {
          if (url.endsWith(suffix)) return response(body);
        }
        return response({}, 404);
      }) as unknown as typeof fetch,
    });

  it("fetches one file per id and reports a missing story as null", async () => {
    // ⚠️ Stories MERGE, so a saved id can stop existing. `null` is an
    // answer the screen renders; dropping the row would make a reader's
    // saved item vanish with no explanation.
    const client = clientFor({
      "/stories/a.json": {
        story: { id: "a", title_bg: "Едно", title_en: "One" },
      },
    });
    const { result } = renderHook(() => useStoryTitles(["a", "gone"], client));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.titles.get("a")).toEqual({
      id: "a",
      title_bg: "Едно",
      title_en: "One",
    });
    expect(result.current.titles.get("gone")).toBe("gone");
  });

  it("does not call an unreachable story missing", async () => {
    // ⚠️ THE DEFECT THIS REPLACED, and `fetchData` states the same rule
    // ~290 lines above the hook: "404 and nothing else". A bare catch
    // rendered every failure as "no longer a separate story", so an
    // offline reader was told every story they had saved was gone. A 404
    // is the release stating an absence; a 502 is us failing to ask.
    const client = createDataClient("https://data.example/news", {
      usePublicationManifest: false,
      fetcher: vi.fn(() => response({}, 502)) as unknown as typeof fetch,
    });
    const { result } = renderHook(() => useStoryTitles(["a"], client));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.titles.get("a")).toBe("failed");
  });

  it("calls a story the release does not have gone", async () => {
    const client = clientFor({});
    const { result } = renderHook(() => useStoryTitles(["a"], client));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.titles.get("a")).toBe("gone");
  });

  it("refuses to build a request from an id the producer could not write", async () => {
    // The id reaches a URL PATH, so anything outside the producer's own
    // charset is refused rather than encoded.
    const client = clientFor({});
    const { result } = renderHook(() => useStoryTitles(["../secret"], client));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.titles.get("../secret")).toBe("gone");
  });

  it("does not re-fetch when the caller rebuilds the array", async () => {
    // ⚠️ A caller that builds `ids` inline hands a new array identity on
    // every render; keyed on identity this would fetch for ever.
    const fetcher = vi.fn((input: RequestInfo | URL) =>
      String(input).endsWith("/stories/a.json")
        ? response({ story: { id: "a", title_bg: "Едно", title_en: null } })
        : response({}, 404),
    );
    const client = createDataClient("https://data.example/news", {
      usePublicationManifest: false,
      fetcher: fetcher as unknown as typeof fetch,
    });
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useStoryTitles(ids, client),
      { initialProps: { ids: ["a"] } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const calls = fetcher.mock.calls.length;
    rerender({ ids: ["a"] });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetcher.mock.calls.length).toBe(calls);
  });

  it("asks for nothing when nothing is saved", async () => {
    const fetcher = vi.fn(() => response({}));
    const client = createDataClient("https://data.example/news", {
      usePublicationManifest: false,
      fetcher: fetcher as unknown as typeof fetch,
    });
    const { result } = renderHook(() => useStoryTitles([], client));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetcher).not.toHaveBeenCalled();
  });
});

/**
 * Plan §4.6(b) — the hot ("overlay") release.
 *
 * ⚠️ THE PROPERTY UNDER TEST IS NOT "THE MERGE IS RIGHT" — that is pinned
 * by `overlayMerge.test.ts` against vectors the Python publisher
 * generates. What is tested here is the WIRING, and specifically the one
 * thing that makes an overlay worth having: a hot release must fetch the
 * overlay and NOT re-fetch the base. A client that quietly re-downloaded
 * the tree would still serve correct data, pass every other test, and buy
 * nothing at all — the failure is invisible except in the request log.
 */
describe("hot releases", () => {
  const overlayObject = (patch: Record<string, unknown> = {}) => ({
    schema_version: 1,
    seq: 1,
    base_run_id: "run-1",
    generated_at: "2026-08-31T07:05:00Z",
    release_generated_at: "2026-08-31T07:05:00Z",
    latest_limit: 150,
    articles: {},
    removed_article_urls: {},
    removed_domains: [],
    bundle_envelopes: {},
    story_details: {},
    removed_story_ids: [],
    home: null,
    replaced_paths: {},
    removed_paths: [],
    ...patch,
  });

  // The pointer describes the overlay BODY the test serves — the client
  // verifies it (T1.5) and drops an overlay whose bytes disagree. An
  // absent body keeps a dummy pointer: those tests 404 the object anyway.
  const hot = (
    runId: string,
    overlayBody?: unknown,
    patch: Record<string, unknown> = {},
    files?: Record<string, unknown>,
  ) => ({
    ...manifest(runId, files),
    overlay: {
      seq: 1,
      ...(overlayBody === undefined
        ? { path: "overlays/1.json", bytes: 10, sha256: "c".repeat(64) }
        : listed("overlays/1.json", overlayBody)),
      base_generated_at: "2026-08-31T07:00:00Z",
      ...patch,
    },
  });

  const clientFor = (
    manifestBody: () => unknown,
    bodies: Record<string, unknown>,
  ) => {
    let clock = 0;
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/manifest.json")) return response(manifestBody());
      for (const [suffix, body] of Object.entries(bodies)) {
        if (url.endsWith(suffix)) {
          return body === undefined ? response({}, 404) : response(body);
        }
      }
      return response({}, 404);
    });
    return {
      fetcher,
      client: createDataClient("https://data.example/news", {
        now: () => clock,
        fetcher: fetcher as unknown as typeof fetch,
        // The manifest is re-read on every call, which is what lets a
        // test move from a cold release to a hot one.
      }),
      advance: (ms: number) => {
        clock += ms;
      },
    };
  };

  it("does not re-fetch the base when only the overlay moves", async () => {
    let body: unknown = manifest("run-1");
    const overlay = overlayObject({ home: { source: "overlay" } });
    const { fetcher, client, advance } = clientFor(() => body, {
      "/home.json": { source: "base" },
      "/overlays/1.json": overlay,
    });

    await expect(client.fetchData("/home.json")).resolves.toEqual({
      source: "base",
    });
    body = hot("run-1", overlay);
    // ⚠️ PAST `DATA_REFRESH_MS`, not merely past the manifest poll. At
    // 60 001 ms this test passed byte-identically against the old blanket
    // 5-minute base expiry — it could not fail if the change it exists to
    // pin were reverted, which is the definition of proving nothing. The
    // hot cadence this enables is five minutes, so this is also the real
    // interval.
    advance(DATA_REFRESH_MS + 1);
    await expect(client.fetchData("/home.json")).resolves.toEqual({
      source: "overlay",
    });

    // One base download, one overlay download. The `run_id` did not move,
    // so nothing cleared and nothing was re-fetched.
    const downloads = fetcher.mock.calls
      .map(([url]) => String(url))
      .filter((url) => !url.endsWith("/manifest.json"));
    expect(downloads).toEqual([
      "https://data.example/news/versions/run-1/home.json",
      "https://data.example/news/versions/run-1/overlays/1.json",
    ]);
  });

  it("serves the base when the overlay cannot be fetched or parsed", async () => {
    // The base is a complete, gated, immutable release — one release
    // behind beats an error page.
    for (const overlayBody of [undefined, { schema_version: 99 }]) {
      const { client } = clientFor(() => hot("run-1", overlayBody), {
        "/home.json": { source: "base" },
        "/overlays/1.json": overlayBody,
      });
      await expect(client.fetchData("/home.json")).resolves.toEqual({
        source: "base",
      });
    }
  });

  it("drops a malformed overlay pointer without dropping the manifest", async () => {
    // ⚠️ The opposite choice takes a reader from "one release behind" to
    // "no data at all", on a field that is optional by construction.
    const { fetcher, client } = clientFor(
      () => hot("run-1", undefined, { path: "../escape.json" }),
      { "/home.json": { source: "base" } },
    );
    await expect(client.fetchData("/home.json")).resolves.toEqual({
      source: "base",
    });
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("escape")),
    ).toBe(false);
  });

  it("supplies a file the base tree does not have", async () => {
    // A new outlet's bundle 404s in the base by construction — the
    // release that introduces it is the overlay.
    const overlay = overlayObject({
      articles: {
        "new.bg": [
          { url: "https://new.bg/1", published: "2026-08-31T07:04:00Z" },
        ],
      },
      bundle_envelopes: {
        "new.bg": {
          domain: "new.bg",
          outlet: "New",
          generated_at: "2026-08-31T07:04:00Z",
        },
      },
    });
    const { client } = clientFor(() => hot("run-1", overlay), {
      "/overlays/1.json": overlay,
    });
    await expect(client.fetchData("/articles/new.bg.json")).resolves.toEqual({
      domain: "new.bg",
      outlet: "New",
      generated_at: "2026-08-31T07:04:00Z",
      articles: [
        { url: "https://new.bg/1", published: "2026-08-31T07:04:00Z" },
      ],
    });
  });

  it("does not answer a server error from the overlay", async () => {
    // ⚠️ An absence is a fact the release states; a 502 is our failure to
    // ask. Answering the second from the overlay renders — and caches —
    // an established outlet as the handful of articles the overlay
    // happens to carry, with no error flag: to a reader, "this outlet
    // published three things this year".
    const clock = 0;
    const overlay = overlayObject({
      articles: {
        "old.bg": [
          { url: "https://old.bg/9", published: "2026-08-31T07:04:00Z" },
        ],
      },
      bundle_envelopes: { "old.bg": { domain: "old.bg" } },
    });
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      // ⚠️ LISTED, so the base fetch is attempted at all: an unlisted path
      // is refused as the release's 404 before the bucket is asked.
      if (url.endsWith("/manifest.json"))
        return response(
          hot("run-1", overlay, {}, { "articles/old.bg.json": { was: 1 } }),
        );
      if (url.endsWith("/overlays/1.json")) return response(overlay);
      return response({}, 502);
    });
    const client = createDataClient("https://data.example/news", {
      now: () => clock,
      fetcher: fetcher as unknown as typeof fetch,
    });
    await expect(client.fetchData("/articles/old.bg.json")).rejects.toThrow(
      /502/,
    );
  });

  it("refuses an overlay pointer that escapes the version directory", async () => {
    // ⚠️ `\` is a path separator to the URL parser, so a rule guarding
    // only `/`-separated `..` lets this out of `versions/<run_id>/`.
    const { fetcher, client } = clientFor(
      () => hot("run-1", undefined, { path: "..\\..\\secret.json" }),
      { "/home.json": { source: "base" } },
    );
    await expect(client.fetchData("/home.json")).resolves.toEqual({
      source: "base",
    });
    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes("secret")),
    ).toBe(false);
  });

  it("still fails for a path neither the base nor the overlay has", async () => {
    const overlay = overlayObject();
    const { client } = clientFor(() => hot("run-1", overlay), {
      "/overlays/1.json": overlay,
    });
    await expect(client.fetchData("/articles/absent.bg.json")).rejects.toThrow(
      /404/,
    );
  });

  it("notifies subscribers when the overlay changes", async () => {
    // ⚠️ THE SIGNAL IS WHAT MAKES LIST SCREENS SEE A HOT RELEASE AT ALL.
    // `applyOverlayToPath` refuses an index page, so `useStoryList` merges
    // its own accumulated prefix — but a base index page is cached, so the
    // poll after a hot release resolves to the SAME object and no React
    // state moves. Without this notification the list would simply never
    // update: everything renders, the data is just old.
    const page = { page: 1, pages: 1, total: 0, stories: [] };
    const files = { "stories/index-1.json": page };
    let body: unknown = manifest("run-1", files);
    const overlay = overlayObject({
      story_details: { s1: { story: { id: "s1" } } },
    });
    const { client, advance } = clientFor(() => body, {
      "/stories/index-1.json": page,
      "/overlays/1.json": overlay,
    });
    const seen: Array<string | null> = [];
    const unsubscribe = client.subscribeOverlay(() => {
      const overlay = client.getOverlay();
      seen.push(overlay ? String(overlay.seq) : null);
    });

    await client.fetchData("/stories/index-1.json");
    expect(client.getOverlay()).toBeNull();
    expect(seen).toEqual([]);

    body = hot("run-1", overlay, {}, files);
    advance(PUBLICATION_POLL_MS + 1);
    await client.fetchData("/stories/index-1.json");
    expect(seen).toEqual(["1"]);
    expect(client.getOverlay()?.story_details).toHaveProperty("s1");

    // ⚠️ And an index page is NOT merged by the client, whatever the
    // overlay says — the hook owns that, over the prefix it holds.
    await expect(
      client.fetchData<{ stories: unknown[] }>("/stories/index-1.json"),
    ).resolves.toMatchObject({ stories: [] });

    unsubscribe();
    body = manifest("run-1", files);
    advance(PUBLICATION_POLL_MS + 1);
    await client.fetchData("/stories/index-1.json");
    expect(seen).toEqual(["1"]);
  });

  it("answers a whole-carried file the base tree does not have from the overlay", async () => {
    // ⚠️ THE MUTATION THIS CATCHES: `overlayCanSupply` ignoring
    // `replaced_paths`. The retired registry reaches a hot reader whose
    // base predates it exactly this way; without this arm the base 404
    // propagated and the story page said the registry could not be read.
    const registry = { generated_at: "", version: 1, retired: { x: {} } };
    const overlay = overlayObject({
      replaced_paths: { "stories/retired.json": registry },
    });
    const { client } = clientFor(() => hot("run-1", overlay), {
      "/overlays/1.json": overlay,
    });
    await expect(client.fetchData("/stories/retired.json")).resolves.toEqual(
      registry,
    );
  });

  it("refuses a path the release retired", async () => {
    const overlay = overlayObject({ removed_story_ids: ["gone"] });
    const { client } = clientFor(() => hot("run-1", overlay), {
      "/stories/gone.json": { story: { id: "gone" } },
      "/overlays/1.json": overlay,
    });
    await expect(client.fetchData("/stories/gone.json")).rejects.toThrow();
  });
});
