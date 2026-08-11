// The Sofia fold, which is the only thing in this hook that is not a straight lookup.
//
// settlements.json puts Sofia's villages in a район (S2xxx); the район shards carry zero
// kmetstva in every cycle because all 32 races are published on the city-wide SOF bundle. So
// the hook has to read TWO different bundles for one settlement, and the test that matters is
// that each field comes from the right one: the race from SOF, the parent context from the
// район. Getting it wrong renders "това населено място няма собствено кметство" on a page
// that a /person badge links to by the name of the village's mayor.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLocalSettlement } from "./useLocalSettlement";

const CYCLE = "2023_10_29_mi";

// Владая (11394) — район Витоша (S2317) in settlements.json, кметство race on SOF.
const VLADAYA = { ekatte: "11394", name: "Владая", obshtina: "S2317" };
// Ореше (53727) — the ordinary shape: the parent município publishes its own race.
const ORESHE = { ekatte: "53727", name: "Ореше", obshtina: "BLG13" };

vi.mock("@/data/settlements/useSettlements", () => ({
  useSettlementsInfo: () => ({
    settlements: [VLADAYA, ORESHE],
    findSettlement: (e?: string) =>
      [VLADAYA, ORESHE].find((s) => s.ekatte === e),
  }),
}));

vi.mock("./useLocalAsOf", () => ({
  useLocalAsOf: () => ({ cycle: CYCLE }),
}));

const bundle = (
  obshtinaCode: string,
  obshtinaName: string,
  kmetstva: string[],
) => ({
  cycle: CYCLE,
  obshtinaCode,
  obshtinaName,
  mayor: { elected: null, candidates: [] },
  council: [],
  kmetstva: kmetstva.map((kmetstvoName) => ({
    kmetstvoName,
    candidates: [],
  })),
});

// The three shards this test can serve. S2317 having NO kmetstva is the real corpus, not a
// simplification — that is the whole defect. Rebuilt per test so a case that removes one
// (the partial-cycle shape) cannot leak into the next.
const allShards = (): Record<string, unknown> => ({
  S2317: bundle("S2317", "Витоша", []),
  SOF: bundle("SOF", "Столична", ["Владая", "Мърчаево", "Бистрица"]),
  BLG13: bundle("BLG13", "Гърмен", ["Ореше", "Балдево"]),
});

let SHARDS = allShards();
const requested: string[] = [];

beforeEach(() => {
  SHARDS = allShards();
  requested.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const code = /municipalities\/([^/.]+)\.json/.exec(String(url))?.[1];
      requested.push(String(code));
      const body = code ? SHARDS[code] : undefined;
      if (!body) return new Response("", { status: 404 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

// stubGlobal survives restoreAllMocks, so without this the setup's "an unstubbed fetch
// throws" guard stays neutered for the rest of the run.
afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe("useLocalSettlement", () => {
  it("resolves a Sofia village's кметство from the SOF bundle, not its район", async () => {
    const { result } = renderHook(() => useLocalSettlement("11394", CYCLE), {
      wrapper,
    });
    await waitFor(() => expect(result.current.kmetstvo).not.toBeNull());
    expect(result.current.kmetstvo?.kmetstvoName).toBe("Владая");
    expect(result.current.kmetstvoObshtina).toBe("SOF");
    expect(requested).toContain("SOF");
  });

  it("keeps the район as the parent context for that same village", async () => {
    // The район is not a detour: Витоша has its own районен кмет and council vote, and the
    // context card links there. Folding the whole screen onto SOF would drop it.
    const { result } = renderHook(() => useLocalSettlement("11394", CYCLE), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.municipality?.obshtinaCode).toBe("S2317"),
    );
    expect(result.current.obshtina).toBe("S2317");
    expect(result.current.municipality?.obshtinaName).toBe("Витоша");
  });

  it("reads one bundle outside Sofia, where the two codes are the same", async () => {
    const { result } = renderHook(() => useLocalSettlement("53727", CYCLE), {
      wrapper,
    });
    await waitFor(() => expect(result.current.kmetstvo).not.toBeNull());
    expect(result.current.kmetstvo?.kmetstvoName).toBe("Ореше");
    expect(result.current.kmetstvoObshtina).toBe("BLG13");
    // The second useLocalMunicipality call shares the query key, so it costs no fetch.
    expect(requested).toEqual(["BLG13"]);
  });

  it("still resolves the race on a partial cycle whose folder lacks the parent shard", async () => {
    // A chmi folder holds only the municipalities that voted, so a Sofia village's район
    // shard 404s while the SOF bundle carrying its by-election is present. The page renders
    // off the race alone in that case — `municipality` being undefined is not "no data".
    delete SHARDS.S2317;
    const { result } = renderHook(() => useLocalSettlement("11394", CYCLE), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.municipality).toBeUndefined();
    expect(result.current.kmetstvo?.kmetstvoName).toBe("Владая");
  });
});
