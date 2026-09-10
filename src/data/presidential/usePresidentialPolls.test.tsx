// `usePresidentialCycleAccuracy`'s three states — the one piece of real
// logic in this file beyond a bare `useQuery` passthrough (the other five
// hooks mirror `usePolls.tsx`'s own untested thin-wrapper shape, per this
// repo's convention of not testing a bare fetch wrapper — see
// docs/testing-standards.md's SEED EXAMPLE, `src/data/fetchJson.test.tsx`).

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PresidentialPollsAccuracy } from "@/data/polls/pollsTypes";
import { usePresidentialCycleAccuracy } from "./usePresidentialPolls";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const ACCURACY: PresidentialPollsAccuracy = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  cycles: [
    {
      cycle: "2021_11_14_pvr",
      round1Date: "2021-11-14",
      decidedInRound: 2,
      winner: "румен георгиев радев",
      actualResults: [],
      agencies: [
        {
          agencyId: "TEST",
          pollId: "test-2021-11-10",
          fieldworkEnd: "2021-11-10",
          daysBefore: 4,
          respondents: 1000,
          errors: [],
          mae: 1.5,
          rmse: 1.8,
          biggestMiss: { key: "румен георгиев радев", error: -2.4 },
          leaderCalled: true,
          runoffPairCalled: true,
          decidedInRoundCalled: true,
          runoff: null,
        },
      ],
    },
  ],
};

describe("usePresidentialCycleAccuracy", () => {
  it("is 'loading' while the cycle prop is not yet resolved", () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(ACCURACY));
    const { result } = renderHook(
      () => usePresidentialCycleAccuracy(undefined),
      { wrapper },
    );
    expect(result.current.status).toBe("loading");
  });

  it("returns 'ready' with the matching cycle's own slice once fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(ACCURACY));
    const { result } = renderHook(
      () => usePresidentialCycleAccuracy("2021_11_14_pvr"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    if (result.current.status !== "ready") throw new Error("unreachable");
    expect(result.current.cycle.agencies).toHaveLength(1);
    expect(result.current.cycle.agencies[0].agencyId).toBe("TEST");
  });

  it("returns 'unscored' — never an empty band — for a cycle with no scored poll", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(ACCURACY));
    const { result } = renderHook(
      () => usePresidentialCycleAccuracy("2026_11_08_pvr"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("unscored"));
  });

  it("returns 'unscored' when accuracy.json itself has not been published yet (a 404)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 404 }),
    );
    const { result } = renderHook(
      () => usePresidentialCycleAccuracy("2021_11_14_pvr"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("unscored"));
  });

  it("logs a warning (and still resolves, rather than reading as ordinary absence) on a network failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"));
    const { result } = renderHook(
      () => usePresidentialCycleAccuracy("2021_11_14_pvr"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.status).toBe("unscored"));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("presidential polls fetch could not complete"),
    );
    warn.mockRestore();
  });
});
