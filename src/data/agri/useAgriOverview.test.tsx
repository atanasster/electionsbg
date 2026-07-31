// The /subsidies overview hook, driven through a real QueryClientProvider with a
// stubbed fetch (vitest.setup.ts makes an unstubbed one throw).
//
// Two contracts, both learned from the permanent-loading-skeleton bug:
//
//  1. A scope the corpus cannot answer (`null` from agriScopeToKey) issues NO
//     request and settles as "loaded, nothing here" — `isLoading` false with
//     undefined data — so the screen can tell it apart from a pending fetch.
//     Reporting it as loading is what left the page on its skeleton forever.
//  2. That state gets its OWN cache key. Sharing the `""` (latest year) key made
//     the disabled query hand back the latest year's cached payload as if it
//     were the answer for the year the reader picked — the same lie, dressed up
//     as data. This is the assertion that catches a key-collision regression.

import { describe, expect, it, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAgriOverview } from "./useAgriOverview";

const LATEST = { generatedFrom: "latest-year" };

const wrapper = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };

const newClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stubs fetch; returns the recorded request URLs. */
const stubFetch = (body: unknown, status = 200) => {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(status === 404 ? "" : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return urls;
};

describe("useAgriOverview", () => {
  it("fetches the default (latest year) overview for an empty key", async () => {
    const urls = stubFetch(LATEST);
    const { result } = renderHook(() => useAgriOverview(""), {
      wrapper: wrapper(newClient()),
    });
    await waitFor(() => expect(result.current.data).toEqual(LATEST));
    expect(urls).toEqual(["/api/db/agri-payload?kind=overview"]);
  });

  it("a null scope issues no request and is not reported as loading", async () => {
    const urls = stubFetch(LATEST);
    const { result } = renderHook(() => useAgriOverview(null), {
      wrapper: wrapper(newClient()),
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(urls).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("a null scope does not inherit the default scope's cached payload", async () => {
    const client = newClient();
    stubFetch(LATEST);
    const first = renderHook(() => useAgriOverview(""), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(first.result.current.data).toEqual(LATEST));
    first.unmount();

    // Same client, so the "" entry is warm: an unsupported year must still come
    // back empty rather than borrowing it.
    const { result } = renderHook(() => useAgriOverview(null), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it("a 404 (an overview scope that was never precomputed) resolves to null, not an error", async () => {
    stubFetch(null, 404);
    const { result } = renderHook(() => useAgriOverview("2019"), {
      wrapper: wrapper(newClient()),
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toBeNull();
  });
});
