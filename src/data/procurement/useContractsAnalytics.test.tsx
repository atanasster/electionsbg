// Unit test for the shared contracts-analytics hook. Stubs fetch (never touches
// the network — vitest.setup.ts makes an unstubbed fetch throw) and drives the
// hook through a real QueryClientProvider, asserting the facet→KPI derivation,
// the bucket→methodF translation, the stale-bucket signal, the enabled gate, and
// the reactive-vs-static CPV facet request shape. See docs/testing-standards.md.

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useContractsAnalytics,
  type ContractsAnalyticsArgs,
} from "./useContractsAnalytics";

// value is `string | boolean` because a bool facet (is_eu_funded) serialises as a
// JS boolean, mirroring node-postgres — the tenders share KPI must handle that.
type FacetRows = { value: string | boolean; count: number }[];
type Req = {
  columns: string[];
  filters: { id: string }[];
  scope?: { col: string; val: string };
};

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

// One canned facet per column: two procedures (open 80 / direct 20), two bid
// counts (single 30 / competitive 70), two CPV divisions. The tenders-shaped
// columns (procedure_type, is_eu_funded) mirror the contracts ones so the
// generalised hook can be exercised without a bid column.
const facetFor = (col: string): FacetRows => {
  if (col === "procurement_method" || col === "procedure_type")
    return [
      { value: "Открита процедура", count: 80 },
      { value: "Пряко възлагане", count: 20 },
    ];
  if (col === "number_of_tenderers")
    return [
      { value: "1", count: 30 },
      { value: "3", count: 70 },
    ];
  if (col === "is_eu_funded")
    // A bool facet returns JS booleans (node-postgres), NOT the strings "true"/
    // "false" — the share predicate must coerce, so mock the real shape.
    return [
      { value: true, count: 35 },
      { value: false, count: 65 },
    ];
  if (col === "cpv")
    return [
      { value: "45", count: 60 },
      { value: "72", count: 40 },
    ];
  return [];
};

// Stub fetch: parse the ?q= facet request, record it, and answer every requested
// column. Returns the captured-request list so a test can assert filter shape.
const stubFacets = (): Req[] => {
  const calls: Req[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const q = JSON.parse(
      new URL(String(url), "http://localhost").searchParams.get("q") ?? "{}",
    ) as Req;
    calls.push(q);
    const facets: Record<string, FacetRows> = {};
    for (const c of q.columns) facets[c] = facetFor(c);
    return jsonResponse({ facets });
  });
  return calls;
};

const makeWrapper = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

const baseArgs: ContractsAnalyticsArgs = {
  resource: "contracts",
  fixedFilters: [{ id: "tag", value: ["contract"] }],
  singleFilter: [],
  cpvFilter: [],
  procBucket: null,
};

describe("useContractsAnalytics", () => {
  it("groups the procedure mix + derives the integrity KPIs when unfiltered", async () => {
    stubFacets();
    const { result } = renderHook(() => useContractsAnalytics(baseArgs), {
      wrapper: makeWrapper(),
    });
    await waitFor(() =>
      expect(result.current.groupedMethods.length).toBeGreaterThan(0),
    );
    // open 80 + direct 20 → direct share 20%.
    expect(result.current.directPct).toBeCloseTo(20);
    // bid counts 1→30, 3→70 → single-bid share 30%.
    await waitFor(() => expect(result.current.singleBidPct).toBeCloseTo(30));
    expect(result.current.cpvOptions).toEqual([
      { value: "45", count: 60 },
      { value: "72", count: 40 },
    ]);
  });

  it("translates a selected bucket into its raw-method filter fragment", async () => {
    stubFacets();
    const { result } = renderHook(
      () => useContractsAnalytics({ ...baseArgs, procBucket: "open" }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() =>
      expect(result.current.methodF).toEqual([
        { id: "procurement_method", value: ["Открита процедура"] },
      ]),
    );
  });

  it("signals onBucketInvalid when the selected bucket is absent from the facet", async () => {
    stubFacets();
    const onBucketInvalid = vi.fn();
    renderHook(
      () =>
        useContractsAnalytics({
          ...baseArgs,
          procBucket: "framework", // not in the canned facet
          onBucketInvalid,
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(onBucketInvalid).toHaveBeenCalled());
  });

  it("stands the analysis facets down when disabled (KPIs null, CPV still runs)", async () => {
    stubFacets();
    const { result } = renderHook(
      () => useContractsAnalytics({ ...baseArgs, enabled: false }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() =>
      expect(result.current.cpvOptions.length).toBeGreaterThan(0),
    );
    expect(result.current.groupedMethods).toEqual([]);
    expect(result.current.singleBidPct).toBeNull();
    expect(result.current.directPct).toBeNull();
  });

  it("fires ONE combined proc+bid request unfiltered, TWO once a bucket is picked", async () => {
    const calls = stubFacets();
    const { rerender } = renderHook(
      (p: ContractsAnalyticsArgs) => useContractsAnalytics(p),
      {
        wrapper: makeWrapper(),
        initialProps: baseArgs,
      },
    );
    // Unfiltered: a single request carrying BOTH columns; no single-column
    // proc/bid request.
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.columns.includes("procurement_method") &&
            c.columns.includes("number_of_tenderers"),
        ),
      ).toBe(true),
    );
    expect(
      calls.some(
        (c) => c.columns.length === 1 && c.columns[0] === "procurement_method",
      ),
    ).toBe(false);

    // Once a bucket is picked the facets split into two dimension-excluding
    // single-column requests.
    rerender({ ...baseArgs, procBucket: "open" });
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.columns.length === 1 && c.columns[0] === "number_of_tenderers",
        ),
      ).toBe(true),
    );
    expect(
      calls.some(
        (c) => c.columns.length === 1 && c.columns[0] === "procurement_method",
      ),
    ).toBe(true);
  });

  it("forwards scope + applies commonFilters to every facet (the company contract)", async () => {
    const calls = stubFacets();
    const yearRange = { id: "date", min: "2024-01-01", max: "2024-12-31" };
    renderHook(
      () =>
        useContractsAnalytics({
          ...baseArgs,
          scope: { col: "contractor_eik", val: "123" },
          commonFilters: [yearRange],
          reactiveCpv: true,
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    // Every facet request carries the entity scope and the common year filter —
    // including the CPV facet (the company screen depends on both).
    for (const c of calls) {
      expect(c.scope).toEqual({ col: "contractor_eik", val: "123" });
      expect(c.filters.some((f) => f.id === "date")).toBe(true);
    }
  });

  it("applies the active method filter to the CPV facet only when reactiveCpv", async () => {
    const cpvReqs = (calls: Req[]) =>
      calls.filter((c) => c.columns.length === 1 && c.columns[0] === "cpv");
    const hasMethod = (c: Req) =>
      c.filters.some((f) => f.id === "procurement_method");

    // Reactive: once the proc facet resolves and methodF populates, the CPV facet
    // re-fires WITH the procurement_method filter (its earlier pre-methodF request
    // does not — hence `.some`, not the first request).
    const reactiveCalls = stubFacets();
    const { unmount } = renderHook(
      () =>
        useContractsAnalytics({
          ...baseArgs,
          procBucket: "open",
          reactiveCpv: true,
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() =>
      expect(cpvReqs(reactiveCalls).some(hasMethod)).toBe(true),
    );
    unmount();

    // Static: the CPV facet key never includes methodF, so no CPV request ever
    // carries a procurement_method filter — even with a bucket selected. Wait for
    // the proc facet (so the bucket path has run) before asserting the negative.
    const staticCalls = stubFacets();
    renderHook(
      () =>
        useContractsAnalytics({
          ...baseArgs,
          procBucket: "open",
          reactiveCpv: false,
        }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() =>
      expect(
        staticCalls.some((c) => c.columns.includes("procurement_method")),
      ).toBe(true),
    );
    await waitFor(() => expect(cpvReqs(staticCalls).length).toBeGreaterThan(0));
    expect(cpvReqs(staticCalls).some(hasMethod)).toBe(false);
  });
});

// Tenders-shaped usage: a custom methodColumn, NO bid column (no single-bid data),
// and an optional share KPI (EU-funded %).
describe("useContractsAnalytics — tenders shape (method-only + shareFacet)", () => {
  const tenderArgs: ContractsAnalyticsArgs = {
    resource: "tenders",
    fixedFilters: [],
    singleFilter: [],
    cpvFilter: [],
    procBucket: null,
    methodColumn: "procedure_type",
    bidColumn: null,
    shareFacet: { column: "is_eu_funded", match: (v) => String(v) === "true" },
  };

  it("derives the mix + directPct + sharePct with no bid facet", async () => {
    const calls = stubFacets();
    const { result } = renderHook(() => useContractsAnalytics(tenderArgs), {
      wrapper: makeWrapper(),
    });
    await waitFor(() =>
      expect(result.current.groupedMethods.length).toBeGreaterThan(0),
    );
    // open 80 + direct 20 → direct share 20%.
    expect(result.current.directPct).toBeCloseTo(20);
    // is_eu_funded true 35 / (35+65) → 35%.
    await waitFor(() => expect(result.current.sharePct).toBeCloseTo(35));
    // No bid column → single-bid KPI is null and number_of_tenderers is never
    // requested.
    expect(result.current.singleBidPct).toBeNull();
    expect(calls.some((c) => c.columns.includes("number_of_tenderers"))).toBe(
      false,
    );
    // While unfiltered the share column rides the combined method request (one
    // round-trip), not a separate one.
    expect(
      calls.some(
        (c) =>
          c.columns.includes("procedure_type") &&
          c.columns.includes("is_eu_funded"),
      ),
    ).toBe(true);
  });

  it("builds methodF against the custom methodColumn", async () => {
    stubFacets();
    const { result } = renderHook(
      () => useContractsAnalytics({ ...tenderArgs, procBucket: "open" }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() =>
      expect(result.current.methodF).toEqual([
        { id: "procedure_type", value: ["Открита процедура"] },
      ]),
    );
  });
});
