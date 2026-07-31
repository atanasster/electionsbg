// Unit test for the "Най-рискови договори" board's data hook. Stubs fetch (never
// touches the network — vitest.setup.ts makes an unstubbed fetch throw) and pins
// the three properties that make the tile honest under the dashboard's ?pscope
// control:
//
//   - the scope window reaches the SERVER as a date range, so the board cannot
//     rank contracts signed outside the period it is sitting under;
//   - the window is part of the QUERY KEY, so flipping the scope refetches instead
//     of re-rendering the previous period's rows under the new label;
//   - `tag` travels in filters.columns. runDbTable's buildWhere reads ONLY
//     req.filters.columns — a top-level `fixedFilters` (the /api/db/facets shape,
//     which DbDataTable merges client-side before it sends) is silently ignored,
//     which is how 235 contractAmendment rows used to rank as contracts.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRiskiestContracts } from "./useRiskiestContracts";

// The scope window is the input under test, so drive it directly rather than
// standing up an ElectionContext + Router just to compute one.
const window_ = vi.hoisted(() => ({
  value: { from: "2026-04-19", to: null, all: false } as {
    from: string | null;
    to: string | null;
    all: boolean;
  },
}));
vi.mock("@/data/scope/useScopeWindow", () => ({
  useScopeWindow: () => ({
    ...window_.value,
    year: null,
    selected: "x",
    scopeKey: "k",
  }),
}));

type Column = { id: string; value?: unknown; min?: string; max?: string };
type Req = {
  resource: string;
  pageSize: number;
  sort: { id: string; desc: boolean }[];
  filters: { columns: Column[] };
  fixedFilters?: unknown;
};

const requests: Req[] = [];
const stubFetch = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const q = new URL(String(url), "http://x").searchParams.get("q") ?? "{}";
      requests.push(JSON.parse(q) as Req);
      return new Response(JSON.stringify({ rows: [], total: 0 }), {
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
  requests.length = 0;
  window_.value = { from: "2026-04-19", to: null, all: false };
  stubFetch();
});

// restoreAllMocks (vitest.setup.ts) does NOT undo stubGlobal — pair them, or the
// setup's "an unstubbed fetch throws" network guard stays neutered for the file.
afterEach(() => {
  vi.unstubAllGlobals();
});

const colOf = (req: Req | undefined, id: string) => {
  if (!req) throw new Error("expected a request to have been made");
  return req.filters.columns.find((c) => c.id === id);
};

describe("useRiskiestContracts", () => {
  it("bounds the ranking by the active scope window", async () => {
    window_.value = { from: "2024-01-01", to: "2025-01-01", all: false };
    const { result } = renderHook(() => useRiskiestContracts(8), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(colOf(requests[0], "date")).toEqual({
      id: "date",
      min: "2024-01-01",
      max: "2025-01-01",
    });
  });

  it("drops the window for the full-corpus scope", async () => {
    window_.value = { from: null, to: null, all: true };
    const { result } = renderHook(() => useRiskiestContracts(8), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(colOf(requests[0], "date")).toBeUndefined();
  });

  it("refetches when the scope changes (the window is in the query key)", async () => {
    const { result, rerender } = renderHook(() => useRiskiestContracts(8), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    window_.value = { from: "2024-01-01", to: "2025-01-01", all: false };
    rerender();
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(colOf(requests[1], "date")?.min).toBe("2024-01-01");
  });

  it("filters to primary contracts and the elevated grades, most-flagged first", async () => {
    const { result } = renderHook(() => useRiskiestContracts(8), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const req = requests[0];
    // In filters.columns, NOT fixedFilters — the table endpoint ignores the latter.
    expect(colOf(req, "tag")?.value).toEqual(["contract"]);
    expect(req.fixedFilters).toBeUndefined();
    expect(colOf(req, "risk_grade")?.value).toEqual(["D", "E", "F"]);
    // Fired count leads; the CRI's varying denominator makes it only a tiebreak.
    expect(req.sort).toEqual([
      { id: "risk_fired", desc: true },
      { id: "risk_cri", desc: true },
    ]);
    expect(req.pageSize).toBe(8);
  });
});
