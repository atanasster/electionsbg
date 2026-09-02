// useInterregOverview's optional `limit` forwarding — the one genuinely new
// piece of logic InterregTile.tsx's "see all programmes" toggle depends on.
// InterregTile.test.tsx mocks this hook entirely, so nothing else in the repo
// exercises the query-string construction or the cache-key split.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useInterregOverview } from "./useInterreg";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
    },
    children,
  );

const fetchedUrl = async (limit?: number) => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  renderHook(() => useInterregOverview(limit), { wrapper });
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return fetchMock.mock.calls[0][0] as string;
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("useInterregOverview limit forwarding", () => {
  it("omits ?limit entirely when called with no argument", async () => {
    const url = await fetchedUrl(undefined);
    expect(url).toBe("/api/db/interreg-overview");
  });

  it("forwards a given limit as a query param", async () => {
    const url = await fetchedUrl(25);
    expect(url).toBe("/api/db/interreg-overview?limit=25");
  });
});
