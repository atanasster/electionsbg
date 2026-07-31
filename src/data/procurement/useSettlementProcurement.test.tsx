// Unit test for the per-settlement procurement hook. Stubs fetch (never touches the
// network — vitest.setup.ts makes an unstubbed fetch throw) and pins the two properties
// that make the page's scope control honest:
//
//   - the window reaches the SERVER as from/to, so the numbers actually narrow;
//   - the window is part of the QUERY KEY, so flipping the scope refetches instead of
//     re-rendering the previous period's figures under the new label.
//
// See docs/plans/procurement-settlement-browser-v1.md §2.2.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  CORPUS_WINDOW,
  useSettlementProcurement,
} from "./useSettlementProcurement";

const payload = { ekatte: "10135", name: "Варна", awarders: [], byYear: [] };

const urls: string[] = [];
const stubFetch = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider
    client={
      new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      })
    }
  >
    {children}
  </QueryClientProvider>
);

beforeEach(() => {
  urls.length = 0;
  stubFetch();
});

// restoreAllMocks (vitest.setup.ts) does NOT undo stubGlobal, so without this the
// setup's "an unstubbed fetch throws" network guard stays neutered for the rest of
// the file. Every other stubGlobal user in src/ pairs them; match them.
afterEach(() => {
  vi.unstubAllGlobals();
});

const paramsOf = (url: string | undefined) => {
  if (!url) throw new Error("expected a request to have been made");
  return new URL(url, "http://x").searchParams;
};

describe("useSettlementProcurement", () => {
  it("sends no window for the corpus scope", async () => {
    const { result } = renderHook(
      () => useSettlementProcurement("10135", CORPUS_WINDOW),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const p = paramsOf(urls[0]);
    expect(p.get("ekatte")).toBe("10135");
    // Absent, not empty: the SQL branches on `p_from IS NULL`, so a blank string
    // would be compared against every date rather than skipping the bound.
    expect(p.has("from")).toBe(false);
    expect(p.has("to")).toBe(false);
  });

  it("forwards a half-open window as from/to", async () => {
    // useScopeWindow's y:2024 is [2024-01-01, 2025-01-01) and the endpoint filters
    // `date < p_to`, so the bounds pass through verbatim — no ±1 day adjustment.
    const { result } = renderHook(
      () =>
        useSettlementProcurement("10135", {
          from: "2024-01-01",
          to: "2025-01-01",
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const p = paramsOf(urls[0]);
    expect(p.get("from")).toBe("2024-01-01");
    expect(p.get("to")).toBe("2025-01-01");
  });

  it("refetches when the window changes — the key is not just the ekatte", async () => {
    // The failure this guards: a query key of [ekatte] alone serves the cached corpus
    // payload under the new scope label, so the pill moves and the numbers do not.
    const { result, rerender } = renderHook(
      ({ w }: { w: { from: string | null; to: string | null } }) =>
        useSettlementProcurement("10135", w),
      { wrapper, initialProps: { w: CORPUS_WINDOW } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(urls).toHaveLength(1);

    rerender({ w: { from: "2024-01-01", to: "2025-01-01" } });
    await waitFor(() => expect(urls).toHaveLength(2));
    expect(paramsOf(urls[1]).get("from")).toBe("2024-01-01");
  });

  it("does not fetch for a malformed ekatte", async () => {
    // `enabled` gates this synchronously, so assert the state rather than racing a
    // timer: isLoading===false with no data is React Query's "disabled" shape.
    const { result } = renderHook(
      () => useSettlementProcurement("nope", CORPUS_WINDOW),
      { wrapper },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(urls).toHaveLength(0);
  });

  it("the tiles ask for the corpus, not a scope", () => {
    // TEST-001. Both tiles live on pages with NO scope control, so a window other than
    // the corpus there would be one nobody chose. This asserts the constant they pass
    // means what it says; the call sites themselves are checked by the type (the
    // parameter is required, so neither can silently omit it).
    expect(CORPUS_WINDOW).toEqual({ from: null, to: null });
    // Frozen: it is a module-level singleton handed to every caller, so a stray
    // mutation would re-scope both tiles at once.
    expect(Object.isFrozen(CORPUS_WINDOW)).toBe(true);
  });
});
