// A FAILED profile lookup must not read as "no such person".
//
// The bug: usePersonProfile mapped every rejection to `null`, and PersonProfileScreen answers
// `null` with the name-keyed portfolio fallback — which calls useNoindex(). So one 500 from
// /api/db/person-profile while Googlebot was rendering de-indexed a healthy, prerendered,
// index,follow person page until the next recrawl, with nothing failing anywhere. Google
// reported 9,752 URLs "Excluded by 'noindex' tag", among them pages that resolve fine.
//
// These tests pin the distinction at the hook (`failed` vs `missing`) and the routing of it at
// the screen. The screen half is a source assertion for the same reason the sibling S5 guard is
// one: mounting PersonDashboard pulls in ~15 fetching child tiles, while the failure being
// guarded — a branch pointed at the wrong state — is a one-token edit.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { usePersonProfileState, usePersonProfile } from "./usePersonProfile";

const PROFILE = { slug: "ivan-petrov-a1b2c3", name: "Иван Петров" };

const mockFetch = (impl: () => Promise<unknown>) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => impl() as never),
  );
};
const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

afterEach(() => vi.unstubAllGlobals());

describe("usePersonProfileState", () => {
  it("resolves a profile to `ok`", async () => {
    mockFetch(async () => ok(PROFILE));
    const { result } = renderHook(() =>
      usePersonProfileState("ivan-petrov-a1b2c3"),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current).toEqual({ status: "ok", profile: PROFILE });
  });

  it("treats a 200 with a null body as `missing` — the route's way of saying nobody", async () => {
    mockFetch(async () => ok(null));
    const { result } = renderHook(() => usePersonProfileState("nobody-000000"));
    await waitFor(() => expect(result.current.status).toBe("missing"));
  });

  it("treats a REJECTED fetch as `failed`, never `missing`", async () => {
    mockFetch(async () => {
      throw new Error("network down");
    });
    const { result } = renderHook(() =>
      usePersonProfileState("ivan-petrov-a1b2c3"),
    );
    await waitFor(() => expect(result.current.status).toBe("failed"));
  });

  it("treats a 500 as `failed` — a non-2xx is not an answer", async () => {
    // Without the r.ok check the error body parses as JSON, yields no `slug`, and reads as
    // "no such person" — which is the exact path that noindexed live pages.
    mockFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "db down" }),
    }));
    const { result } = renderHook(() =>
      usePersonProfileState("ivan-petrov-a1b2c3"),
    );
    await waitFor(() => expect(result.current.status).toBe("failed"));
  });

  it("treats a non-JSON body as `failed`", async () => {
    mockFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    }));
    const { result } = renderHook(() =>
      usePersonProfileState("ivan-petrov-a1b2c3"),
    );
    await waitFor(() => expect(result.current.status).toBe("failed"));
  });

  it("treats an empty key as `missing` without fetching", async () => {
    mockFetch(async () => ok(PROFILE));
    const { result } = renderHook(() => usePersonProfileState(""));
    await waitFor(() => expect(result.current.status).toBe("missing"));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("usePersonProfile (back-compat tri-state)", () => {
  it("still collapses a failure to null for the callers that cannot act on it", async () => {
    // Safe ONLY because none of those callers noindex — CandidateScreen and
    // CandidateProfileHeader omit the person block, PersonContractsScreen filters by name.
    mockFetch(async () => {
      throw new Error("network down");
    });
    const { result } = renderHook(() => usePersonProfile("ivan-petrov-a1b2c3"));
    await waitFor(() => expect(result.current).toBeNull());
  });
});

const SRC = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "PersonProfileScreen.tsx",
  ),
  "utf8",
);

describe("PersonProfileScreen routes the four states apart", () => {
  it("sends `failed` to the unavailable view, NOT to the noindexing fallback", () => {
    expect(SRC).toMatch(
      /state\.status === "failed"\)\s*return <PersonProfileUnavailable \/>/,
    );
    // PersonScreen is the branch that calls useNoindex(); only a genuine miss may reach it.
    expect(SRC).toMatch(
      /state\.status === "missing"\)\s*return <PersonScreen \/>/,
    );
  });

  it("keeps the unavailable view free of any noindex call", () => {
    const view = SRC.slice(
      SRC.indexOf("const PersonProfileUnavailable"),
      SRC.indexOf("export const PersonProfileScreen"),
    );
    expect(view.length).toBeGreaterThan(0);
    expect(view).not.toMatch(/useNoindex/);
  });
});
