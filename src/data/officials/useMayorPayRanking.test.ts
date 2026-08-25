// Pins the deliberate throw-rather-than-degrade contract this hook's own
// header comment states: a failed fetch must surface as `isError`, never as
// an empty `rows` array indistinguishable from "no mayor declared any pay".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useMayorPayRanking } from "./useMayorPayRanking";

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

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("useMayorPayRanking", () => {
  it("returns the rows on a successful response", async () => {
    const payload = [{ obshtina: "DOB03", income_eur: 64303 }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => payload }),
    );
    const { result } = renderHook(() => useMayorPayRanking(), { wrapper });
    await waitFor(() => expect(result.current.rows.length).toBe(1));
    expect(result.current.isError).toBe(false);
  });

  it("surfaces isError rather than an empty array on a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 500, json: async () => [] }),
    );
    const { result } = renderHook(() => useMayorPayRanking(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    // The failure state and "the corpus is genuinely empty" state must stay
    // distinguishable — `rows` degrades to [] for rendering convenience, but
    // `isError` is what a consumer must branch on before trusting that.
    expect(result.current.rows).toEqual([]);
  });
});
