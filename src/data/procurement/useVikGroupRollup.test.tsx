// The client half of the ex-member basis guard (docs/plans/water-hub-v1.md G3):
// `exMembers` is true ONLY when the server echoes it. A function deployed before
// the switch ignores the param and omits the key; its member-inclusive counts
// must then never sit beside an ex-member national rate.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useVikGroupRollup } from "./useVik";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
    },
    createElement(MemoryRouter, null, children),
  );

const respond = (body: unknown, ok = true) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })),
  );

const OP = {
  eik: "130175000",
  contractCount: 10,
  totalEur: 100,
  bidKnownN: 8,
  singleBidN: 3,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useVikGroupRollup", () => {
  it("asks for the ex-member basis and reports it when the server confirms", async () => {
    respond({ operators: [OP], exMembers: true });
    const { result } = renderHook(() => useVikGroupRollup(["130175000"]), {
      wrapper,
    });
    await waitFor(() => expect(result.current.operators).toHaveLength(1));
    expect(result.current.exMembers).toBe(true);
    expect(result.current.operators[0].singleBidN).toBe(3);
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain("exMembers=1");
  });

  it("does not claim the basis when an older function omits the key", async () => {
    respond({ operators: [OP] });
    const { result } = renderHook(() => useVikGroupRollup(["130175000"]), {
      wrapper,
    });
    await waitFor(() => expect(result.current.operators).toHaveLength(1));
    expect(result.current.exMembers).toBe(false);
  });

  it("does not claim the basis on a failed request", async () => {
    respond(null, false);
    const { result } = renderHook(() => useVikGroupRollup(["130175000"]), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.exMembers).toBe(false);
    expect(result.current.operators).toEqual([]);
  });
});
