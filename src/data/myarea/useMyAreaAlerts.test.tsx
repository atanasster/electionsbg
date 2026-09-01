// The repair this hook exists to carry, asserted rather than assumed: an unregistered kind is
// dropped (and said so), an absent vintage does not become a crash, and the refetch triggers
// an open tab needs are actually declared — the last being the one that looked done and was
// not, because the app-wide client switches every trigger off.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { FC, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MYAREA_ALERTS_STALE_MS,
  useMyAreaAlerts,
  type MyAreaAlertEvent,
} from "./useMyAreaAlerts";

const okEvent: MyAreaAlertEvent = {
  date: "2026-08-20",
  kind: "council_resolution",
  headline_bg: "Решение",
  headline_en: "Resolution",
};

const wrapper = (): FC<{ children: ReactNode }> => {
  // A per-test client with retries off, so a rejected query settles in one tick instead of
  // waiting out the app client's `retry: 1`.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

const mockJson = (body: unknown, ok = true): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => body })),
  );
};

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useMyAreaAlerts", () => {
  it("drops a row whose kind is not in the registry and keeps the rest", async () => {
    mockJson({
      obshtina: "SFO",
      refreshedAt: "2026-09-01T21:14:00.000Z",
      events: [okEvent, { ...okEvent, kind: "not_a_kind" }],
    });
    const { result } = renderHook(() => useMyAreaAlerts("SFO"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.events).toHaveLength(1);
    expect(result.current.data?.events[0].kind).toBe("council_resolution");
  });

  it("reports what it dropped, because the count alone cannot show it", async () => {
    // The rendered count is the count AFTER the filter, so a reader has no baseline — a
    // dropped row is exactly as silent as the grey row it replaced. The hazard is a real
    // deploy ordering: the builder publishes to Postgres while ALERT_KINDS ships in the
    // bundle, so a builder run before `npm run deploy` empties a live feed of a whole kind.
    // Asserted on the DATA rather than on a DEV-gated log, which would be silent in exactly
    // the situation that matters.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockJson({
      obshtina: "SFO",
      refreshedAt: "2026-09-01T21:14:00.000Z",
      events: [okEvent, { ...okEvent, kind: "brand_new_kind" }],
    });
    const { result } = renderHook(() => useMyAreaAlerts("SFO"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.droppedKinds).toEqual(["brand_new_kind"]);
    expect(result.current.data?.events).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("brand_new_kind"),
    );
  });

  it("reports nothing on a healthy payload", async () => {
    // The other half: a gate that only ever sees the broken case cannot tell whether it
    // discriminates. `droppedKinds` must be empty when every kind is known.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockJson({
      obshtina: "SFO",
      refreshedAt: "2026-09-01T21:14:00.000Z",
      events: [okEvent],
    });
    const { result } = renderHook(() => useMyAreaAlerts("SFO"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.droppedKinds).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("survives a payload with no vintage instead of handing one to the tile", async () => {
    // `refreshedAt` arrives behind an `as` cast. The app mounts one error boundary and it is
    // unrelated to this tree, so an unguarded read here is a white screen on /my-area/*.
    mockJson({ obshtina: "SFO", events: [okEvent] });
    const { result } = renderHook(() => useMyAreaAlerts("SFO"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.generatedAt).toBeUndefined();
    expect(result.current.data?.events).toHaveLength(1);
  });

  it("maps refreshedAt to generatedAt when it is a string", async () => {
    mockJson({
      obshtina: "SFO",
      refreshedAt: "2026-09-01T21:14:00.000Z",
      events: [okEvent],
    });
    const { result } = renderHook(() => useMyAreaAlerts("SFO"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.generatedAt).toBe("2026-09-01T21:14:00.000Z");
  });

  it("treats an explicit null body as 'this município has no feed'", async () => {
    mockJson(null);
    const { result } = renderHook(() => useMyAreaAlerts("XXX"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("does not fetch without a município", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    renderHook(() => useMyAreaAlerts(null), { wrapper: wrapper() });
    expect(f).not.toHaveBeenCalled();
  });

  it("declares the refetch triggers an idle open tab needs", () => {
    // ⚠️ THE ONE ASSERTION THAT PINS THE ACTUAL CONTRACT. `staleTime` is a permission, not a
    // trigger: the app-wide client sets refetchOnWindowFocus and refetchOnReconnect to false,
    // so lowering staleTime alone leaves a mounted idle query with no asker at all and the
    // feed as stale as it was under `Infinity`. Read off the hook's own options so a future
    // edit that drops them fails here rather than silently reverting the repair.
    const src = useMyAreaAlerts.toString();
    expect(src).toContain("refetchOnWindowFocus");
    expect(src).toContain("refetchInterval");
    expect(src).toContain("refetchIntervalInBackground");
    expect(MYAREA_ALERTS_STALE_MS).toBe(30 * 60 * 1000);
  });
});
