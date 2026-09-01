import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDataClient,
  DATA_REFRESH_MS,
  parseOutletArticlesBundle,
  useDataWithClient,
} from "./data";

const response = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

const manifest = (runId: string) => ({
  version: 3,
  run_id: runId,
  generated_at: "2026-08-31T07:00:00Z",
  data_base: `versions/${runId}`,
  home_health_ready: true,
  accepted_snapshot_records_sha256: null,
  accepted_feedback_records_sha256: null,
  bundle: {
    sha256: "a".repeat(64),
    files: 1,
    bytes: 2,
    inventory: [{ path: "home.json", bytes: 2, sha256: "b".repeat(64) }],
  },
});

describe("versioned news data client", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("moves to a new complete version after the manifest changes", async () => {
    let clock = 0;
    let current = "run-1";
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/manifest.json")) return response(manifest(current));
      return response({ source: url.includes("run-1") ? "one" : "two" });
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
    const legacy = { ...manifest("legacy"), version: 1 } as Record<
      string,
      unknown
    >;
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
        ? response(manifest("same-run"))
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
        return failManifest ? response({}, 503) : response(manifest("stable"));
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
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(
      "https://data.example/news/versions/stable/home.json",
    );
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
      resolveNew({
        ok: true,
        status: 200,
        json: async () => ({ value: "new" }),
      } as Response);
      await Promise.resolve();
    });
    expect(hook.result.current.data).toEqual({ value: "new" });

    await act(async () => {
      resolveOld({
        ok: true,
        status: 200,
        json: async () => ({ value: "old" }),
      } as Response);
      await Promise.resolve();
    });
    expect(hook.result.current.data).toEqual({ value: "new" });
    hook.unmount();
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
      articles: Array<Record<string, unknown> & { analysis: Record<string, unknown> }>;
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
    value.articles[0].analysis.reviewed_links = [{
      surface: "Иван", kind: "person", id: "p1", canonical: "Иван Иванов",
      href: "https://electionsbg.com/person/p1",
    }];
    expect(parseOutletArticlesBundle(value)).toBeTruthy();

    value.articles[0].analysis.reviewed_links = [{
      surface: "Иван", kind: "person", id: "p1", canonical: "Иван Иванов",
      href: "https://evil.example/person/p1",
    }];
    expect(() => parseOutletArticlesBundle(value)).toThrow(/проверените връзки/);
    value.articles[0].analysis.reviewed_links = [];
    (value.articles[0].editorial_feedback as Record<string, unknown>)
      .source_submission_ids = ["private"];
    expect(() => parseOutletArticlesBundle(value)).toThrow(/обратна връзка/);
  });
});
