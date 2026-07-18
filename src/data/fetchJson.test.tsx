// SEED EXAMPLE — the "data layer" (fetch + React Query) via Testing Library.
// See docs/testing-standards.md.
//
// Two things every data test in src/ must do and this file demonstrates:
//   1. STUB fetch — never hit the network. vitest.setup.ts makes an unstubbed
//      fetch throw, so a test that forgets to stub fails loudly instead of
//      reaching GCS. Here we re-point the same spy per case.
//   2. Drive React Query hooks through a real QueryClientProvider with
//      `renderHook` + `waitFor`, mirroring the repo's useXxx() hook pattern
//      (turn retries OFF so a failure surfaces immediately).
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { fetchJsonSoft, fetchJsonMap } from "./fetchJson";

// Real Response objects (global in both node and jsdom) — more faithful than a
// hand-rolled double, and fully typed.
const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const notFound = () => new Response("", { status: 404 });
// A 200 that serves HTML (the Vite dev-server SPA fallback): .json() rejects.
const htmlFallback = () => new Response("<!doctype html>", { status: 200 });

describe("fetchJsonSoft", () => {
  it("returns parsed JSON on a hit", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ hello: "мир" }),
    );
    await expect(fetchJsonSoft("/x.json")).resolves.toEqual({ hello: "мир" });
  });

  it("soft-misses (null) on a genuine 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(notFound());
    await expect(fetchJsonSoft("/missing.json")).resolves.toBeNull();
  });

  it("soft-misses (null) on the dev SPA HTML fallback (200 non-JSON)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlFallback());
    await expect(fetchJsonSoft("/spa-path")).resolves.toBeNull();
  });
});

describe("fetchJsonMap", () => {
  it("picks the requested key out of a shard map", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ "123": { name: "A" }, "456": { name: "B" } }),
    );
    await expect(fetchJsonMap("/shard.json", "456")).resolves.toEqual({
      name: "B",
    });
    await expect(fetchJsonMap("/shard.json", "999")).resolves.toBeNull();
  });
});

// The repo's data hooks are thin useQuery wrappers over a fetch. This is the
// canonical way to test one: stub fetch, render under a provider, await success.
describe("useQuery data-hook pattern", () => {
  const wrapper = ({ children }: { children: ReactNode }) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };

  const useThing = (id: string) =>
    useQuery({
      queryKey: ["thing", id],
      queryFn: () => fetchJsonSoft<{ id: string }>(`/things/${id}.json`),
    });

  it("resolves the hook to the fetched payload", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ id: "42" }));
    const { result } = renderHook(() => useThing("42"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: "42" });
  });
});
