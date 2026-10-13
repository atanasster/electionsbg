// The resolution every /candidate/:id sub-route renders from. The case that matters: an
// `mp-<id>` no election holds a candidacy shard for, which the main candidate page renders
// from the parliament roster and links its sub-routes to — those sub-routes must resolve
// the same MP rather than tell the reader the person does not exist.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../ElectionContext", () => ({
  useElectionContext: () => ({
    elections: ["2026_04_19", "2024_10_27"],
    selected: "2026_04_19",
    setSelected: vi.fn(),
  }),
}));

import { useCandidateRoute } from "./useCandidateRoute";

const ROSTER = {
  mps: [
    {
      id: 3643,
      name: "Иван Петров Иванов",
      name_en: "Ivan Petrov Ivanov",
      normalizedName: "ИВАН ПЕТРОВ ИВАНОВ",
      normalizedName_en: "IVAN PETROV IVANOV",
      photoUrl: "",
    },
  ],
};

const respond = (status: number, body?: unknown) =>
  ({
    ok: status < 400,
    status,
    url: "",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
  }) as Response;

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useCandidateRoute", () => {
  it("resolves an mp- slug no election holds from the parliament roster", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(
        url.endsWith("/api/db/mp-roster") ? respond(200, ROSTER) : respond(404),
      ),
    );
    const { result } = renderHook(() => useCandidateRoute("mp-3643"), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.lookupName).toBe("Иван Петров Иванов"),
    );
    expect(result.current.rosterMp?.id).toBe(3643);
    expect(result.current.notFound).toBe(false);
    expect(result.current.isResolving).toBe(false);
  });

  it("reports not-found for an mp- slug the roster lacks too", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(
        url.endsWith("/api/db/mp-roster") ? respond(200, ROSTER) : respond(404),
      ),
    );
    const { result } = renderHook(() => useCandidateRoute("mp-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.lookupName).toBeNull();
    expect(result.current.isResolving).toBe(false);
  });

  it("keys a bare-name URL on the name itself", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(respond(404)));
    const { result } = renderHook(() => useCandidateRoute("Иван Петров"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(result.current.lookupName).toBe("Иван Петров");
    expect(result.current.notFound).toBe(false);
  });
});
