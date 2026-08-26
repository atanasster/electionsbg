// The hub tile figure and the page each tile opens must be the same number. Both are
// derived from `?pscope` through `useMpAssetsScope` → `mpAssetsNsScope`, so what this
// pins is that the hook actually FOLLOWS the param — the half no type can enforce.
//
// The gap it guards is 15×: measured on the committed blob, the 52nd is 42 cars and
// 240 MPs with declared assets against 643 and 2,122 all-time. A hook stuck on one
// bucket renders a defensible-looking number under the other window's label, at a 200.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDeclarationsHubStats } from "./useDeclarationsHubStats";

const BLOB = {
  computedAt: "2026-08-20",
  people: 63782,
  peopleWithDeclaration: 21170,
  officials: 14583,
  organisations: 17620,
  organisationPeople: 14866,
  byNs: {
    "52": { mpsWithAssets: 240, cars: 42, carOwners: 23 },
    all: { mpsWithAssets: 2122, cars: 643, carOwners: 360 },
  },
};

const at = (url: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    // `retry: false` so a fetch rejection surfaces as a failed assertion rather than
    // a timeout that reads like a hang.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return (
      <MemoryRouter initialEntries={[url]}>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };

const load = async (url: string) => {
  const { result } = renderHook(() => useDeclarationsHubStats(), {
    wrapper: at(url),
  });
  await waitFor(() => expect(result.current.stats).toBeDefined());
  return result;
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => BLOB })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("useDeclarationsHubStats follows ?pscope", () => {
  it("reads the selected parliament's slice by default", async () => {
    const r = await load("/governance/declarations");
    expect(r.current.scope).toBe("ns");
    expect(r.current.bucket).toBe("52");
    expect(r.current.nsStats).toEqual(BLOB.byNs["52"]);
  });

  it("reads the roll-up on ?pscope=all", async () => {
    const r = await load("/governance/declarations?pscope=all");
    expect(r.current.scope).toBe("all");
    expect(r.current.bucket).toBe("all");
    expect(r.current.nsStats).toEqual(BLOB.byNs.all);
  });

  it("clamps an inbound YEAR back to the parliament slice", async () => {
    // `?pscope` is in the usePreserveParams allowlist, so a year minted on
    // /procurement rides an ordinary in-app link here. This register has no year
    // slices — 2024 held two parliaments — so the only honest answers are the
    // selected parliament or an explicit gap; silently widening to `all` would
    // multiply every figure on the page by 15.
    const r = await load("/governance/declarations?pscope=y:2019");
    expect(r.current.scope).toBe("ns");
    expect(r.current.nsStats).toEqual(BLOB.byNs["52"]);
  });

  it("distinguishes the two buckets — the gate is not vacuous", async () => {
    // Guards against a fixture whose two slices happen to be equal, which would let
    // a hook stuck on one bucket pass every assertion above.
    expect(BLOB.byNs["52"]).not.toEqual(BLOB.byNs.all);
  });
});
