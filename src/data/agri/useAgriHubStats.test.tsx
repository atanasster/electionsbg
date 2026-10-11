import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useAgriHubStats } from "./useAgriHubStats";

const stats = (scopeKey: string) => ({ scopeKey, totalEur: 1 });

const wrapper = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

describe("useAgriHubStats keepPrevious", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** fetch that resolves each scope only when the test says so. */
  const deferredFetch = () => {
    const pending = new Map<string, () => void>();
    vi.stubGlobal("fetch", (url: string) => {
      const scope = new URL(url, "http://x").searchParams.get("scope")!;
      return new Promise((resolve) =>
        pending.set(scope, () =>
          resolve({ ok: true, json: async () => stats(scope) } as Response),
        ),
      );
    });
    return (scope: string) => pending.get(scope)?.();
  };

  it("holds the previous scope's figures while the next loads, only when asked", async () => {
    const release = deferredFetch();
    const { result, rerender } = renderHook(
      ({ scope }) => ({
        held: useAgriHubStats(scope, { keepPrevious: true }).data,
        plain: useAgriHubStats(scope).data,
      }),
      { wrapper: wrapper(), initialProps: { scope: "2023" as string | null } },
    );
    release("2023");
    await waitFor(() => expect(result.current.held?.scopeKey).toBe("2023"));
    rerender({ scope: "2024" });
    expect(result.current.held?.scopeKey).toBe("2023");
    expect(result.current.plain).toBeUndefined();
    release("2024");
    await waitFor(() => expect(result.current.held?.scopeKey).toBe("2024"));
  });

  it("never holds figures over for a scope the corpus does not cover", async () => {
    const release = deferredFetch();
    const { result, rerender } = renderHook(
      ({ scope }) => useAgriHubStats(scope, { keepPrevious: true }).data,
      { wrapper: wrapper(), initialProps: { scope: "2023" as string | null } },
    );
    release("2023");
    await waitFor(() => expect(result.current?.scopeKey).toBe("2023"));
    rerender({ scope: null });
    expect(result.current).toBeUndefined();
  });
});
