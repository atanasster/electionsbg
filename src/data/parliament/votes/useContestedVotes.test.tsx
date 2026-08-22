// The tile's heading used to claim "this week" unconditionally, and the hook gave it no way
// to know better: the window is anchored on the corpus's NEWEST SITTING, so through a recess
// it is weeks behind wall-clock today (the 52nd's last sitting was 2026-07-24, and the tile
// was still headed „тази седмица" on 2026-08-11), and the thin-window fallback is not a
// window at all — it ranks the whole term.
//
// So what is pinned here is the pair (basis, anchor) the caption is written from, on BOTH
// paths: the /api/db route and the topic_index.json fallback a database-less checkout uses.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useContestedVotes } from "./useContestedVotes";
import type { TopicEntry } from "./types";

vi.mock("@/data/ElectionContext", () => ({
  useElectionContext: () => ({ selected: "2026_04_19" }),
}));
vi.mock("@/data/parliament/nsFolders", () => ({
  electionToNsFolder: () => "52",
}));

const entry = (date: string, contestScore: number, item: number): TopicEntry =>
  ({
    date,
    item,
    slug: `${item}`,
    title: `item ${item}`,
    topic: "бюджет",
    contestScore,
    outcome: "passed",
    tally: { yes: 100, no: 80, abstain: 5 },
  }) as unknown as TopicEntry;

// The route's own shape: both tiers in one response, anchor = max(date) over the term.
let pgBody: unknown = null;
let jsonBody: unknown = undefined;
let pgStatus = 200;

const stubFetch = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = String(url).includes("/api/db/contested-votes")
        ? [pgBody, pgStatus]
        : [jsonBody, 200];
      return new Response(JSON.stringify(body[0]), {
        status: body[1] as number,
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
  pgBody = null;
  jsonBody = undefined;
  pgStatus = 200;
  stubFetch();
});

// restoreAllMocks does not undo stubGlobal — pair them, or vitest.setup.ts's
// "an unstubbed fetch throws" network guard stays neutered for the rest of the file.
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useContestedVotes", () => {
  it("reports the window basis anchored on the newest sitting, not on today", async () => {
    pgBody = {
      anchor: "2026-07-24",
      recent: [
        entry("2026-07-24", 0.4, 1),
        entry("2026-07-24", 0.3, 2),
        entry("2026-07-23", 0.2, 3),
      ],
      allTime: [entry("2026-05-01", 0.9, 9)],
    };
    const { result } = renderHook(() => useContestedVotes(7, 5), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.basis).toBe("window");
    // The caption's date. Wall-clock today is irrelevant — a recess must not move it.
    expect(result.current.anchor).toBe("2026-07-24");
    expect(result.current.items).toHaveLength(3);
  });

  it("reports the all-time basis when the window is thin", async () => {
    pgBody = {
      anchor: "2026-07-24",
      recent: [entry("2026-07-24", 0.4, 1)],
      allTime: [entry("2026-05-01", 0.9, 9), entry("2026-06-02", 0.8, 8)],
    };
    const { result } = renderHook(() => useContestedVotes(7, 5), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Two rows under a "last 7 days" caption would be the original defect inverted: the
    // rows shown are the term's, not the window's.
    expect(result.current.basis).toBe("allTime");
    expect(result.current.items.map((i) => i.item)).toEqual([9, 8]);
  });

  it("keeps an anchor when the route omits one, so the caption never loses its date", async () => {
    pgBody = {
      anchor: null,
      recent: [],
      allTime: [entry("2026-05-01", 0.9, 9), entry("2026-06-02", 0.8, 8)],
    };
    const { result } = renderHook(() => useContestedVotes(7, 5), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.anchor).toBe("2026-06-02");
  });

  // The two JSON-fallback tests that stood here are gone with the arm they covered
  // (json-retirement-v2 Tier 3b). Their PG twins above — "reports the window basis anchored
  // on the newest sitting" and "reports the all-time basis when the window is thin" — assert
  // the same two behaviours on the path that remains, so nothing lost coverage.
  //
  // What replaces them is the honest-empty case: with no fallback, a failed route must yield
  // an empty tile rather than a wrong one.
  it("renders nothing, not a stale ranking, when the route fails", async () => {
    pgStatus = 500;
    const { result } = renderHook(() => useContestedVotes(7, 5), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(result.current.anchor).toBeNull();
  });
});
