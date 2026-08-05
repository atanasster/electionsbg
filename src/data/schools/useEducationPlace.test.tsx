// The hook's job is small and load-bearing: fetch the SLIM per-place blob, not
// the 647 KB directory (plan P5), and resolve the two МИР aliases onto codes the
// corpus actually has. vitest.setup.ts makes an unstubbed fetch throw, so a
// request to the wrong URL fails loudly rather than silently costing a megabyte.

import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { useEducationPlace } from "./useEducationPlace";

const wrapper = ({ children }: PropsWithChildren) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const stubFetch = (body: unknown) => {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => body,
  } as Response);
  return spy;
};

describe("useEducationPlace", () => {
  it("fetches the place blob, never the directory", async () => {
    const spy = stubFetch({ code: "SML", grain: "region" });
    const { result } = renderHook(() => useEducationPlace("SML"), { wrapper });
    await waitFor(() => expect(result.current.place).not.toBeNull());
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("kind=place");
    expect(url).toContain("key=SML");
    expect(url).not.toContain("kind=directory");
    expect(result.current.aliased).toBe(false);
  });

  it("fetches Sofia city's blob for a Sofia МИР and flags the substitution", async () => {
    const spy = stubFetch({ code: "S23", grain: "region" });
    const { result } = renderHook(() => useEducationPlace("S25"), { wrapper });
    await waitFor(() => expect(result.current.place).not.toBeNull());
    expect(String(spy.mock.calls[0][0])).toContain("key=S23");
    expect(result.current.aliased).toBe(true);
  });

  it("issues nothing without a code", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useEducationPlace(null), { wrapper });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.place).toBeNull();
  });

  it("reports a place with no blob as absent, not as an error", async () => {
    stubFetch(null); // the route answers null for a place with no schools
    const { result } = renderHook(() => useEducationPlace("BLG99"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.place).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it("distinguishes a failed request from an empty one", async () => {
    // A cloud database mid-rollout answers null; a 500 is a different thing,
    // and a caller that hides both identically can never tell them apart.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    const { result } = renderHook(() => useEducationPlace("SML"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.place).toBeNull();
  });
});
