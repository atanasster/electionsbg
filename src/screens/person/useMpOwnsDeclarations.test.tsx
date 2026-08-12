// `useMpOwnsDeclarations` decides which of two components opens the person page's ONE
// `#declarations` section — PersonMpSections (MP snapshot + filing list) or the standalone
// PersonDeclarations. Both callers read this predicate instead of testing their own
// lookalike condition.
//
// The id is a deep-link target (MpScorecardTile's net-worth metric drills to it), so the
// invariant is not merely "never two" — it is that the element which paints first is the one
// that STAYS. A predicate that answers false and then true destroys the scroll anchor
// mid-navigation, which is what the roster-window test below exists to prevent.
//
// Two layers, deliberately. The `describe("boolean arithmetic")` block mocks the two data
// hooks to pin the truth table cheaply. The `describe("roster window")` block runs the REAL
// hooks against a stubbed fetch, because the defect that shipped lived precisely in the layer
// the mocks replace: outside CandidateMpProvider the id resolves through the ~950 KB roster,
// both queries stay disabled meanwhile, and a disabled query reports isLoading === false
// (query-core: isLoading = isPending && isFetching).

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CandidateMpProvider } from "@/data/candidates/CandidateMpContext";
import type { MpAssetsRollup } from "@/data/dataTypes";
import type { ReactNode } from "react";

const mpAssets = vi.fn();
const mpDeclarations = vi.fn();

vi.mock("@/data/parliament/useMpAssets", async (orig) => {
  const actual = await orig<typeof import("@/data/parliament/useMpAssets")>();
  return {
    ...actual,
    useMpAssets: (name?: string | null) =>
      mocked ? mpAssets(name) : actual.useMpAssets(name),
  };
});
vi.mock("@/data/parliament/useMpDeclarations", async (orig) => {
  const actual =
    await orig<typeof import("@/data/parliament/useMpDeclarations")>();
  return {
    ...actual,
    useMpDeclarations: (name?: string | null) =>
      mocked ? mpDeclarations(name) : actual.useMpDeclarations(name),
  };
});

// Flipped per describe-block: the truth-table tests want the stubs, the roster-window test
// wants the real hooks (its whole point is the wiring the stubs would erase).
let mocked = true;

import { useMpOwnsDeclarations } from "./useMpOwnsDeclarations";

const rollup = { latestDeclarationYear: 2024 } as MpAssetsRollup;

describe("useMpOwnsDeclarations — boolean arithmetic", () => {
  beforeEach(() => {
    mocked = true;
    mpAssets.mockReset();
    mpDeclarations.mockReset();
    mpAssets.mockReturnValue({ rollup: undefined, isLoading: false });
    mpDeclarations.mockReturnValue({ declarations: [], isLoading: false });
  });

  it("is false for a non-MP, and skips the two mp-* calls", () => {
    const { result } = renderHook(() =>
      useMpOwnsDeclarations("Иван Иванов", null),
    );
    expect(result.current).toBe(false);
    // undefined, not the name: both hooks are `enabled: !!id`, so a non-MP issues neither
    // /api/db/mp-assets nor /api/db/mp-declarations. (It does NOT skip the roster — see the
    // hook's comment; that is a property of useMpIdForName, not of this guard.)
    expect(mpAssets).toHaveBeenCalledWith(undefined);
    expect(mpDeclarations).toHaveBeenCalledWith(undefined);
  });

  it("is true once the MP rollup has arrived", () => {
    mpAssets.mockReturnValue({ rollup, isLoading: false });
    const { result } = renderHook(() =>
      useMpOwnsDeclarations("Сергей Дмитриевич Станишев", 868),
    );
    expect(result.current).toBe(true);
  });

  it("is true WHILE either query is in flight", () => {
    // MpAssetsSummary reserves its card height while the queries settle, so the MP block
    // opens the section — but `!rollup` is also true then, so the old standalone gate opened
    // a second one with the same id.
    mpAssets.mockReturnValue({ rollup: undefined, isLoading: true });
    const { result: a } = renderHook(() => useMpOwnsDeclarations("X", 1));
    expect(a.current).toBe(true);

    mpAssets.mockReturnValue({ rollup: undefined, isLoading: false });
    mpDeclarations.mockReturnValue({ declarations: [], isLoading: true });
    const { result: b } = renderHook(() => useMpOwnsDeclarations("X", 1));
    expect(b.current).toBe(true);
  });

  it("is false for an mp id that settled with no MP filing", () => {
    // A minister who never took a seat: they hold an mp id but filed only in the officials
    // register, so the MP block renders nothing and the standalone block must take the
    // section — otherwise their declarations disappear entirely.
    const { result } = renderHook(() => useMpOwnsDeclarations("X", 1));
    expect(result.current).toBe(false);
  });
});

describe("useMpOwnsDeclarations — the roster window", () => {
  beforeEach(() => {
    mocked = false;
  });
  afterEach(() => {
    mocked = true;
    vi.unstubAllGlobals();
  });

  const wrap = (ctx: { id: number; name: string } | null) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <CandidateMpProvider value={ctx ? { ...ctx, entry: null } : null}>
          {children}
        </CandidateMpProvider>
      </QueryClientProvider>
    );
  };

  // The roster NEVER settles, so this is the whole pre-roster window held open. Everything
  // else answers immediately.
  const stubRosterHang = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).includes("/api/db/mp-roster")
          ? new Promise(() => {})
          : Promise.resolve({
              ok: true,
              status: 200,
              url: String(url),
              json: async () => null,
            } as Response),
      ),
    );

  it("is TRUE from the first render for an MP, even with the roster hanging", async () => {
    // The regression this whole restructure exists to prevent. Inside the provider the id is
    // known synchronously, so the mp-assets query is ENABLED on render 1 and isLoading is
    // true — the predicate never passes through a false that would hand the section to the
    // standalone block and then take it back.
    stubRosterHang();
    const { result } = renderHook(
      () => useMpOwnsDeclarations("Сергей Дмитриевич Станишев", 868),
      { wrapper: wrap({ id: 868, name: "Сергей Дмитриевич Станишев" }) },
    );
    expect(result.current).toBe(true);
  });

  it("WITHOUT the provider it is false while the roster hangs — the defect, pinned", async () => {
    // Kept as a live demonstration rather than prose: if someone drops the provider from
    // PersonDashboard, this is the behaviour that returns. A disabled query reports
    // isLoading === false, so the predicate reads "no MP filing" for a sitting MP.
    stubRosterHang();
    const { result } = renderHook(
      () => useMpOwnsDeclarations("Сергей Дмитриевич Станишев", 868),
      { wrapper: wrap(null) },
    );
    expect(result.current).toBe(false);
  });

  it("settles to false for an mp id whose filings come back empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          ({
            ok: true,
            status: 200,
            url: String(url),
            json: async () => null,
          }) as Response,
      ),
    );
    const { result } = renderHook(() => useMpOwnsDeclarations("X", 1), {
      wrapper: wrap({ id: 1, name: "X" }),
    });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
