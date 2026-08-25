// Pins the Sofia canonicalization the tile silently needed once already
// (MyAreaGovernmentCard, src/lib/obshtinaPlace.ts's header): the route's own
// code for the capital is `SOF00`, but `municipal_officials_table` — which
// mayor_pay_by_obshtina() reads through — keys the capital under `SFO_CITY`.
// Without the fold, /governance/SOF00 fetches a município mayor_pay_by_obshtina
// cannot find and the tile self-hides on the capital's own page.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useMayorPay } from "./useMayorPay";

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

const fetchedUrl = async (obshtina: string | undefined) => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => null });
  vi.stubGlobal("fetch", fetchMock);
  renderHook(() => useMayorPay(obshtina), { wrapper });
  if (obshtina == null) {
    // enabled: false — nothing should ever be requested.
    await new Promise((r) => setTimeout(r, 0));
    return fetchMock.mock.calls[0]?.[0] as string | undefined;
  }
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  return fetchMock.mock.calls[0][0] as string;
};

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("useMayorPay obshtina canonicalization", () => {
  it("rewrites SOF00 (the route's Sofia code) to SFO_CITY before fetching", async () => {
    const url = await fetchedUrl("SOF00");
    expect(url).toContain("obshtina=SFO_CITY");
    expect(url).not.toContain("SOF00");
  });

  it("leaves an ordinary EKATTE obshtina code unchanged", async () => {
    const url = await fetchedUrl("DOB03");
    expect(url).toContain("obshtina=DOB03");
  });

  it("never fetches when obshtina is undefined", async () => {
    const url = await fetchedUrl(undefined);
    expect(url).toBeUndefined();
  });
});
