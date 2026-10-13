// The cross-election fallback behind every /candidate/:id screen. What it must get right:
//
//   1. a slug URL (`c-<partyNum>-<slug>`, `mp-<id>`) is minted in ONE election, so it is
//      probed by its by-slug shard — the bare-name regions.json probe never finds it, which
//      is how /candidate/c-28-…/settlements rendered a blank page with no `?elections=`;
//   2. an HTML 200 is not a hit (dev middleware and Firebase both serve the SPA shell for a
//      missing file), so the content-type decides;
//   3. the NEWEST hit wins and the election context is switched to it;
//   4. a slug no election holds is reported as not-found rather than left loading or empty.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSyncExternalStore, type ReactNode } from "react";

const ELECTIONS = ["2026_04_19", "2024_10_27", "2024_06_09", "2023_04_02"];
let selected = ELECTIONS[0];
const listeners = new Set<() => void>();
const setSelected = vi.fn((e: string) => {
  selected = e;
  listeners.forEach((l) => l());
});

vi.mock("../ElectionContext", () => ({
  useElectionContext: () => {
    const sel = useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => selected,
    );
    return { elections: ELECTIONS, selected: sel, setSelected };
  },
}));

import {
  probePath,
  useCandidateElectionFallback,
  useResolvedCandidateWithFallback,
} from "./useCandidateElectionFallback";

const SLUG = "c-28-shaban-shaban-hadzhioli";
const RECORD = {
  name: "Шабан Шабан Хаджиоли",
  name_en: "Shaban Shaban Hadzhioli",
  slug: SLUG,
  partyNum: 28,
  mpId: null,
  mpEntry: null,
  cikRows: [],
};

const json = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
  }) as Response;
const html = () =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "text/html" }),
    json: () => Promise.reject(new Error("not json")),
  }) as Response;
const notFound = () =>
  ({
    ok: false,
    status: 404,
    headers: new Headers(),
    json: () => Promise.reject(new Error("404")),
  }) as Response;

/** Serve `files` (path suffix → body); everything else 404s. */
const serve = (files: Record<string, unknown>, htmlFallback = false) => {
  const seen: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    seen.push(url);
    const hit = Object.keys(files).find((p) => url.endsWith(p));
    if (hit) return Promise.resolve(json(files[hit]));
    return Promise.resolve(htmlFallback ? html() : notFound());
  });
  return seen;
};

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  selected = ELECTIONS[0];
  setSelected.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("probePath", () => {
  it("probes the by-slug shard for slug kinds and regions.json for a bare name", () => {
    expect(
      probePath("2024_06_09", {
        kind: "cik",
        partyNum: 28,
        nameSlug: "shaban-shaban-hadzhioli",
      }),
    ).toBe(`/2024_06_09/candidates/by-slug/${SLUG}.json`);
    expect(probePath("2024_06_09", { kind: "mp", mpId: 3643 })).toBe(
      "/2024_06_09/candidates/by-slug/mp-3643.json",
    );
    expect(probePath("2024_06_09", { kind: "name", name: "Иван" })).toBe(
      "/2024_06_09/candidates/Иван/regions.json",
    );
  });
});

describe("useCandidateElectionFallback", () => {
  it("finds a cik slug in the one election that minted it", async () => {
    const seen = serve({
      [`/2024_06_09/candidates/by-slug/${SLUG}.json`]: RECORD,
    });
    const { result } = renderHook(
      () =>
        useCandidateElectionFallback(
          { kind: "cik", partyNum: 28, nameSlug: "shaban-shaban-hadzhioli" },
          true,
        ),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isProbing).toBe(false));
    expect(result.current.fallbackElection).toBe("2024_06_09");
    // The selected election is never re-probed, and no bare-name probe fires.
    expect(seen.some((u) => u.includes(ELECTIONS[0]))).toBe(false);
    expect(seen.some((u) => u.includes("regions.json"))).toBe(false);
  });

  it("picks the newest election when several hold the slug", async () => {
    serve({
      "/2024_10_27/candidates/by-slug/mp-3643.json": {},
      "/2023_04_02/candidates/by-slug/mp-3643.json": {},
    });
    const { result } = renderHook(
      () => useCandidateElectionFallback({ kind: "mp", mpId: 3643 }, true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isProbing).toBe(false));
    expect(result.current.fallbackElection).toBe("2024_10_27");
  });

  it("does not count an HTML 200 (the SPA shell) as a hit", async () => {
    serve({}, true);
    const { result } = renderHook(
      () => useCandidateElectionFallback({ kind: "mp", mpId: 1 }, true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isProbing).toBe(false));
    expect(result.current.fallbackElection).toBeNull();
  });

  it("fires nothing while disabled", () => {
    const seen = serve({});
    const { result } = renderHook(
      () => useCandidateElectionFallback({ kind: "mp", mpId: 1 }, false),
      { wrapper },
    );
    expect(result.current).toEqual({
      isProbing: false,
      fallbackElection: null,
    });
    expect(seen).toEqual([]);
  });
});

describe("useResolvedCandidateWithFallback", () => {
  it("switches to the election holding the slug and resolves the candidate", async () => {
    serve({ [`/2024_06_09/candidates/by-slug/${SLUG}.json`]: RECORD });
    const { result } = renderHook(
      () => useResolvedCandidateWithFallback(SLUG),
      { wrapper },
    );
    await waitFor(() => expect(result.current.canonical?.slug).toBe(SLUG));
    expect(setSelected).toHaveBeenCalledWith("2024_06_09");
    expect(result.current.isResolving).toBe(false);
    expect(result.current.notFound).toBe(false);
  });

  it("does not probe when the selected election already holds the candidate", async () => {
    const seen = serve({
      [`/2026_04_19/candidates/by-slug/${SLUG}.json`]: RECORD,
    });
    const { result } = renderHook(
      () => useResolvedCandidateWithFallback(SLUG),
      { wrapper },
    );
    await waitFor(() => expect(result.current.canonical?.slug).toBe(SLUG));
    expect(setSelected).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
  });

  it("reports not-found for a slug no election holds", async () => {
    serve({});
    const { result } = renderHook(
      () => useResolvedCandidateWithFallback("c-99-nobody"),
      { wrapper },
    );
    expect(result.current.notFound).toBe(false);
    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.isResolving).toBe(false);
    expect(setSelected).not.toHaveBeenCalled();
  });

  it("never reports a bare name as not-found", async () => {
    serve({});
    const { result } = renderHook(
      () => useResolvedCandidateWithFallback("Иван Петров"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(result.current.notFound).toBe(false);
    expect(result.current.matches).toEqual([]);
  });
});
