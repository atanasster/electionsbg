// The hook that decides which body /candidate/:id renders. Three things it must get right,
// each with a live consequence and none of them visible in a diff:
//
//   1. the ELECTION rides along for a bare name and NOT for a slug (a slug is already
//      party-unique, and the election would be dead weight in the query string);
//   2. a non-2xx is `failed`, never `personSlug: null` — read as an answer, a transient route
//      error sends a shared name to the legacy name-keyed body, which publishes two people's
//      preference history as one person's at a 200;
//   3. every state resets between lookups, so a second URL cannot inherit the first's
//      namesake set or its failure.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { useCandidatePerson } from "./useCandidatePerson";

const NAMESAKES = [
  {
    personSlug: "a",
    displayName: "Боян Иванов Бойчев",
    latestElection: "2024_10_27",
    candidacies: [],
  },
  {
    personSlug: "b",
    displayName: "Боян Иванов Бойчев",
    latestElection: "2023_04_02",
    candidacies: [],
  },
];

const jsonOk = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;
const jsonErr = (status: number) =>
  ({
    ok: false,
    status,
    json: () => Promise.resolve({ error: "db error" }),
  }) as Response;

const mockFetch = (impl: (url: string) => Response) => {
  const seen: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    seen.push(url);
    return Promise.resolve(impl(url));
  });
  return seen;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useCandidatePerson", () => {
  it("sends the election with a bare name", async () => {
    const seen = mockFetch(() =>
      jsonOk({ personSlug: "boyan-boychev-1a9q2r", namesakes: [] }),
    );
    const { result } = renderHook(() =>
      useCandidatePerson("Боян Иванов Бойчев", "2024_10_27"),
    );
    await waitFor(() =>
      expect(result.current.personSlug).toBe("boyan-boychev-1a9q2r"),
    );
    expect(seen[0]).toContain("name=");
    expect(seen[0]).toContain("election=2024_10_27");
    expect(result.current.failed).toBe(false);
  });

  it("sends NO election for a candidate slug", async () => {
    // `c-…` / `mp-…` are party-unique, so the election cannot narrow anything and the route
    // takes a different lookup entirely.
    const seen = mockFetch(() =>
      jsonOk({ personSlug: "boyan-boychev-1a9q2r", namesakes: [] }),
    );
    const { result } = renderHook(() =>
      useCandidatePerson("c-28-boyan-ivanov-boychev", "2024_10_27"),
    );
    await waitFor(() => expect(result.current.personSlug).not.toBeUndefined());
    expect(seen[0]).toContain("slug=");
    expect(seen[0]).not.toContain("election=");
  });

  it("carries the namesake set through on a refusal", async () => {
    mockFetch(() => jsonOk({ personSlug: null, namesakes: NAMESAKES }));
    const { result } = renderHook(() =>
      useCandidatePerson("Боян Иванов Бойчев", "2026_04_19"),
    );
    await waitFor(() => expect(result.current.namesakes).toHaveLength(2));
    expect(result.current.personSlug).toBeNull();
    expect(result.current.failed).toBe(false);
  });

  it("carries it through on a HIT too — that is the shared-name disclosure", async () => {
    mockFetch(() => jsonOk({ personSlug: "a", namesakes: NAMESAKES }));
    const { result } = renderHook(() =>
      useCandidatePerson("Боян Иванов Бойчев", "2024_10_27"),
    );
    await waitFor(() => expect(result.current.personSlug).toBe("a"));
    expect(result.current.namesakes).toHaveLength(2);
  });

  it("reports a non-2xx as FAILED, not as 'no such person'", async () => {
    // The error body parses as JSON and yields no personSlug, so without the `res.ok` check
    // this state is indistinguishable from a genuine miss — and a miss mounts the body that
    // merges namesakes.
    mockFetch(() => jsonErr(500));
    const { result } = renderHook(() =>
      useCandidatePerson("Боян Иванов Бойчев", "2024_10_27"),
    );
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.personSlug).toBeNull();
    expect(result.current.namesakes).toEqual([]);
  });

  it("treats a 200 with no slug as a real miss", async () => {
    mockFetch(() => jsonOk({ personSlug: null, namesakes: [] }));
    const { result } = renderHook(() =>
      useCandidatePerson("Не Съществува Човек", "2024_10_27"),
    );
    await waitFor(() => expect(result.current.personSlug).toBeNull());
    expect(result.current.failed).toBe(false);
  });

  it("resets every field when the id changes", async () => {
    // A stale namesake set or a stale `failed` would make the next URL render the previous
    // one's answer — the chooser for a name that resolves, or a blank for one that does not.
    let body: unknown = { personSlug: null, namesakes: NAMESAKES };
    mockFetch(() => jsonOk(body));
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useCandidatePerson(id, "2024_10_27"),
      { initialProps: { id: "Боян Иванов Бойчев" } },
    );
    await waitFor(() => expect(result.current.namesakes).toHaveLength(2));
    body = { personSlug: "someone-else", namesakes: [] };
    rerender({ id: "Друг Човек" });
    await waitFor(() => expect(result.current.personSlug).toBe("someone-else"));
    expect(result.current.namesakes).toEqual([]);
  });

  it("answers null immediately for an empty id, without a request", async () => {
    const seen = mockFetch(() => jsonOk({ personSlug: null, namesakes: [] }));
    const { result } = renderHook(() => useCandidatePerson("", "2024_10_27"));
    await waitFor(() => expect(result.current.personSlug).toBeNull());
    expect(seen).toEqual([]);
  });
});
