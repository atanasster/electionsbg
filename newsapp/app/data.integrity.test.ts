import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDataClient, IntegrityError, verifyPublished } from "./data";

/**
 * T1.5 — the consumption boundary. The manifest lists `bytes` and `sha256`
 * per published file; until this the client parsed whatever arrived. Every
 * test here serves a manifest that DESCRIBES one body and then serves a
 * different one, which is the only way to prove the description is read.
 */

const encode = (body: unknown) => Buffer.from(JSON.stringify(body));
const listed = (path: string, body: unknown) => ({
  path,
  bytes: encode(body).length,
  sha256: createHash("sha256").update(encode(body)).digest("hex"),
});
const manifest = (files: Record<string, unknown>, overlay?: unknown) => {
  const inventory = Object.entries(files).map(([p, b]) => listed(p, b));
  return {
    version: 3,
    run_id: "run-1",
    generated_at: "2026-09-21T07:00:00Z",
    data_base: "versions/run-1",
    home_health_ready: true,
    accepted_snapshot_records_sha256: null,
    accepted_feedback_records_sha256: null,
    bundle: {
      sha256: "a".repeat(64),
      files: inventory.length,
      bytes: inventory.reduce((t, f) => t + f.bytes, 0),
      inventory,
    },
    ...(overlay === undefined
      ? {}
      : {
          overlay: {
            seq: 1,
            ...listed("overlays/1.json", overlay),
            base_generated_at: "2026-09-21T07:00:00Z",
          },
        }),
  };
};
const response = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const overlayObject = (patch: Record<string, unknown> = {}) => ({
  schema_version: 1,
  seq: 1,
  base_run_id: "run-1",
  generated_at: "2026-09-21T07:05:00Z",
  release_generated_at: "2026-09-21T07:00:00Z",
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

/** A client whose manifest DESCRIBES `described` while it SERVES `served`. */
const clientFor = (
  described: Record<string, unknown>,
  served: Record<string, unknown>,
  overlay?: { described: unknown; served: unknown },
  options: Parameters<typeof createDataClient>[1] = {},
) => {
  const fetcher = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/manifest.json"))
      return response(manifest(described, overlay?.described));
    if (url.endsWith("/overlays/1.json"))
      return overlay ? response(overlay.served) : response({}, 404);
    for (const [path, body] of Object.entries(served))
      if (url.endsWith(`/${path}`)) return response(body);
    return response({}, 404);
  });
  const client = createDataClient("https://data.example/news", {
    fetcher: fetcher as unknown as typeof fetch,
    ...options,
  });
  return { client, fetcher };
};

afterEach(() => vi.restoreAllMocks());

describe("payload integrity at the consumption boundary", () => {
  it("serves a payload whose bytes are the ones the manifest published", async () => {
    const { client } = clientFor(
      { "home.json": { source: "base" } },
      { "home.json": { source: "base" } },
    );
    await expect(client.fetchData("/home.json")).resolves.toEqual({
      source: "base",
    });
    expect(client.integrity()).toBe("verified");
  });

  it("refuses a payload whose hash disagrees, and does not cache the refusal", async () => {
    // ⚠️ THE MUTATION THIS CATCHES: comparing nothing. Same length, one
    // character changed — a substituted file, not a truncated one.
    const { client, fetcher } = clientFor(
      { "home.json": { source: "base" } },
      { "home.json": { source: "bAse" } },
    );
    await expect(client.fetchData("/home.json")).rejects.toBeInstanceOf(
      IntegrityError,
    );
    await expect(client.fetchData("/home.json")).rejects.toThrow(/sha256/);
    // Evicted, not pinned: the second call asked the network again.
    expect(
      fetcher.mock.calls.filter(([u]) => String(u).endsWith("/home.json")),
    ).toHaveLength(2);
  });

  it("names a truncated transfer as a byte mismatch, before any hash", async () => {
    const { client } = clientFor(
      { "home.json": { source: "base", padding: "xxxxxxxx" } },
      { "home.json": { source: "base" } },
    );
    await expect(client.fetchData("/home.json")).rejects.toThrow(
      /bytes, manifest says/,
    );
  });

  it("refuses a base path the manifest does not list, as the 404 the release states", async () => {
    // ⚠️ THE MUTATION THIS CATCHES: serving an unlisted path unverified. The
    // inventory names every file in the tree, so an object the manifest
    // does not list is either absent or was put there outside the publish
    // — and the second must not become data. The bucket is never asked.
    const { client, fetcher } = clientFor(
      { "home.json": { source: "base" } },
      { "home.json": { source: "base" }, "stories/new.json": { id: "new" } },
    );
    await expect(client.fetchData("/stories/new.json")).rejects.toThrow(/404/);
    expect(
      fetcher.mock.calls.some(([u]) => String(u).endsWith("/stories/new.json")),
    ).toBe(false);
  });

  it("verifies a payload against the manifest it was requested under, not the one live when it arrives", async () => {
    // ⚠️ THE MUTATION THIS CATCHES: reading the shared inventory at
    // response time. A fetch started under run-1 that lands after the poll
    // moved to run-2 would be checked against run-2's hash and a valid
    // payload refused with the exact message a real tamper produces.
    const A = { source: "run-1" };
    const B = { source: "run-2" };
    let clock = 0;
    let runId = "run-1";
    let release!: (value: Response) => void;
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/manifest.json"))
        return response({
          ...manifest({ "home.json": runId === "run-1" ? A : B }),
          run_id: runId,
          data_base: `versions/${runId}`,
        });
      if (url.includes("/versions/run-1/home.json"))
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return response(B);
    });
    const client = createDataClient("https://data.example/news", {
      fetcher: fetcher as unknown as typeof fetch,
      now: () => clock,
    });
    const inFlight = client.fetchData("/home.json");
    await new Promise((r) => setTimeout(r, 0));
    // The manifest rolls over while run-1's body is still on the wire.
    runId = "run-2";
    clock = 61_000;
    await expect(client.fetchData("/stats.json")).rejects.toThrow(/404/);
    release(new Response(JSON.stringify(A)));
    await expect(inFlight).resolves.toEqual(A);
  });

  it("drops an overlay whose bytes disagree with the pointer, keeping the base", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const described = overlayObject({ home: { source: "overlay" } });
    const served = overlayObject({ home: { source: "tampered" } });
    const { client } = clientFor(
      { "home.json": { source: "base" } },
      { "home.json": { source: "base" } },
      { described, served },
    );
    await expect(client.fetchData("/home.json")).resolves.toEqual({
      source: "base",
    });
    expect(client.getOverlay()).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/overlays\/1\.json: integrity check failed/),
    );
  });

  it("applies an overlay whose bytes are the ones the pointer describes", async () => {
    const overlay = overlayObject({ home: { source: "overlay" } });
    const { client } = clientFor(
      { "home.json": { source: "base" } },
      { "home.json": { source: "base" } },
      { described: overlay, served: overlay },
    );
    await expect(client.fetchData("/home.json")).resolves.toEqual({
      source: "overlay",
    });
  });

  it("says so, once, when the platform cannot verify — and never claims it did", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = clientFor(
      { "home.json": { source: "base" }, "stats.json": { n: 1 } },
      { "home.json": { source: "bAse" }, "stats.json": { n: 1 } },
      undefined,
      { digest: null },
    );
    expect(client.integrity()).toBe("unverified");
    await expect(client.fetchData("/home.json")).resolves.toEqual({
      source: "bAse",
    });
    await client.fetchData("/stats.json");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/UNVERIFIED/);
  });

  it("reports integrity as off when no manifest is in use", () => {
    const client = createDataClient("/news-data", {
      usePublicationManifest: false,
    });
    expect(client.integrity()).toBe("off");
  });
});

describe("verifyPublished", () => {
  const digest = async (bytes: ArrayBuffer) =>
    createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const bytes = encode({ a: 1 });
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );

  it("passes exactly the published bytes", async () => {
    await expect(
      verifyPublished("x.json", buffer, listed("x.json", { a: 1 }), digest),
    ).resolves.toBeUndefined();
  });

  it("fails a different body of the same length on the hash", async () => {
    await expect(
      verifyPublished("x.json", buffer, listed("x.json", { a: 2 }), digest),
    ).rejects.toThrow(/sha256/);
  });
});
