// The FOLD — which query shape becomes which of the four states.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THIS IS THE HALF THAT GETS IT WRONG. `AgriScopeGate.test.tsx` covers the RENDERING of each
// state, which is an `if (state === …)` chain a reviewer can read. The derivation below is the
// half with the boolean precedence, the `isSuccess && !data` subtlety, and the documented
// history: 52b242609f fixed a live defect where a query React Query had PAUSED — no data, no
// error, `isLoading` false — was folded into „no data for this year", so the page told a reader
// ДФЗ published nothing for 2016 and then listed 2016 among the published years two lines below.
//
// Until this file existed nothing in the repo called `useAgriScope` at all. The mutation that
// proves it: append `|| paused` to the `noData` term. Every test in AgriScopeGate.test.tsx
// stays green (they hand the component a hand-built state) and every screen test stays green
// (they mock the hook wholesale) — and the site re-ships the exact regression above.
//
// The seam is `useAgriOverview`, stubbed here, which is the same seam the screen tests use one
// level up. No network, no QueryClient.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

type Q = {
  data: unknown;
  isError: boolean;
  isSuccess: boolean;
  fetchStatus: "idle" | "fetching" | "paused";
  refetch: () => void;
};

const q = vi.hoisted(() => ({
  /** What `useAgriOverview` returns, and the KEY it was called with — the second matters:
   *  a scope outside the corpus must produce NO request, not an empty one. */
  value: null as unknown as Q,
  calledWith: undefined as string | null | undefined,
}));

vi.mock("./useAgriOverview", () => ({
  useAgriOverview: (key: string | null) => {
    q.calledWith = key;
    return q.value;
  },
}));

const { useAgriScope } = await import("./useAgriScope");

const wrapper = (url: string) =>
  function W({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  };

const at = (url = "/subsidies/recipients") =>
  renderHook(() => useAgriScope(), { wrapper: wrapper(url) }).result.current;

/** A query in flight: nothing yet, no error, actively fetching. */
const FETCHING: Q = {
  data: undefined,
  isError: false,
  isSuccess: false,
  fetchStatus: "fetching",
  refetch: vi.fn(),
};

beforeEach(() => {
  q.value = FETCHING;
  q.calledWith = undefined;
});

describe("useAgriScope — the four-state fold", () => {
  it("a payload in hand is ready", () => {
    q.value = {
      ...FETCHING,
      data: { scopeYear: 2025 },
      isSuccess: true,
      fetchStatus: "idle",
    };
    expect(at().state).toBe("ready");
  });

  it("a PAUSED query is failed, never noData", () => {
    // THE REGRESSION. No data, no error, not fetching — indistinguishable from „the
    // register published nothing" to any check that infers absence from the lack of an
    // error. Two causes, both ordinary: an offline browser and a HIDDEN document (a
    // backgrounded tab whose fetch failed).
    q.value = { ...FETCHING, fetchStatus: "paused" };
    const r = at();
    expect(r.state).toBe("failed");
    expect(r.paused).toBe(true);
  });

  it("an errored query is failed", () => {
    q.value = { ...FETCHING, isError: true, fetchStatus: "idle" };
    const r = at();
    expect(r.state).toBe("failed");
    expect(r.paused).toBe(false);
  });

  it("a settled fetch carrying nothing is noData", () => {
    // A 404 or a 200-null, both mapped to null by fetchAgriPayload. This is the ONLY
    // shape in which „ДФЗ publishes nothing for this year" is a true sentence.
    q.value = {
      ...FETCHING,
      data: null,
      isSuccess: true,
      fetchStatus: "idle",
    };
    expect(at().state).toBe("noData");
  });

  it("a scope outside the corpus is noData, and makes no request at all", () => {
    // 2019 is a valid procurement scope and is not a CAP financial year. It reaches this
    // module on ordinary in-app links, so the hook must not build a key `agri_payloads`
    // cannot answer and then sit on a reply that will never carry data.
    const r = at("/subsidies/recipients?pscope=y:2019");
    expect(r.state).toBe("noData");
    expect(
      q.calledWith,
      "a request was built for a scope the corpus has no key for",
    ).toBeNull();
  });

  it("everything else is loading", () => {
    expect(at().state).toBe("loading");
  });

  it("resolves the default scope to the corpus's own key, not to a calendar year", () => {
    // `ns` has no per-parliament meaning here; `agriScopeToKey` maps it to '' — the
    // latest-financial-year partition. Asserted through the hook because that is where a
    // truthiness slip on the empty string would bite.
    q.value = {
      ...FETCHING,
      data: { scopeYear: 2025 },
      isSuccess: true,
      fetchStatus: "idle",
    };
    at();
    expect(q.calledWith).toBe("");
  });

  it("passes the all-years scope through as its own key", () => {
    at("/subsidies/recipients?pscope=all");
    expect(q.calledWith).toBe("all");
  });
});
