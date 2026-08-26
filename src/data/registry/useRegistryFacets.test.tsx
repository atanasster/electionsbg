// `useRegistryFacets` — and specifically the `bySpec` contract, which had no test anywhere.
//
// ⚠️ THE DEFECT THIS PINS COST 162× ON A LIVE PAGE. Two specs may facet the SAME column with
// deliberately different filter sets, and both be right: a picker's VOCABULARY must exclude its
// own dimension (or the dropdown collapses to the option already chosen), while a DENOMINATOR
// or a corpus breakdown must include it. `Object.assign` then hands the second answer to both,
// in `Object.entries` order, with nothing to show for it. Measured on /persons, where
// `is_company` sat in both the `groups` and `kpis` specs: at `?facet=mp` the „Бизнес" row read
// 526 while clicking it returned 85,060.
//
// It was untestable from either screen suite — both return the same fixture for every facet
// request, so `merged` and `bySpec` are identical by construction there.

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { useRegistryFacets } from "./useRegistryFacets";

const wrap = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      }),
    },
    children,
  );

/** The request each call made, so a test can assert what reached the engine. */
let calls: { resource: string; columns: string[]; filters: unknown[] }[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const req = JSON.parse(
        decodeURIComponent(String(url).split("?q=")[1] ?? "{}"),
      );
      calls.push(req);
      // Each spec gets a DISTINCT answer for the same column, which is the whole point: the
      // narrow one is what a picker must show, the wide one what a breakdown must show.
      const narrow = (req.filters ?? []).length > 0;
      return {
        ok: true,
        json: async () => ({
          facets: {
            entity_class: narrow
              ? [{ value: "coop", count: 7 }]
              : [
                  { value: "company", count: 988_644 },
                  { value: "coop", count: 2_708 },
                ],
          },
        }),
      } as unknown as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("useRegistryFacets", () => {
  it("⚠️ bySpec keeps EACH spec's answer; merged keeps only the last", () => {
    // The contract, stated as the thing that goes wrong: a consumer reading `merged` for a
    // column two specs request gets whichever answer `Object.entries` visited last.
    return (async () => {
      const { result } = renderHook(
        () =>
          useRegistryFacets("companies", {
            picker: {
              columns: ["entity_class"],
              filters: [{ id: "status", value: ["active"] }],
            },
            breakdown: { columns: ["entity_class"], filters: [] },
          }),
        { wrapper: wrap },
      );
      await waitFor(() =>
        expect(Object.keys(result.current.bySpec).length).toBe(2),
      );
      await waitFor(() =>
        expect(result.current.bySpec.breakdown.entity_class).toBeDefined(),
      );

      // Each spec kept its OWN answer…
      expect(result.current.bySpec.picker.entity_class).toEqual([
        { value: "coop", count: 7 },
      ]);
      expect(result.current.bySpec.breakdown.entity_class).toHaveLength(2);

      // …while the flat merge holds exactly one of them, which is why a consumer of a
      // two-spec column must name its spec.
      expect(result.current.merged.entity_class).toHaveLength(2);
      expect(result.current.merged.entity_class).not.toEqual(
        result.current.bySpec.picker.entity_class,
      );
    })();
  });

  it("sends each spec as its OWN request, with its own filter subset", async () => {
    // A facet must exclude its own dimension, which is only expressible as one request per
    // dimension. One shared request would make that impossible.
    const { result } = renderHook(
      () =>
        useRegistryFacets("companies", {
          a: { columns: ["status"], filters: [] },
          b: {
            columns: ["oblast_name"],
            filters: [{ id: "status", value: ["active"] }],
          },
        }),
      { wrapper: wrap },
    );
    await waitFor(() => expect(calls.length).toBe(2));
    expect(result.current.bySpec.a).toBeDefined();
    expect(calls.map((c) => c.columns)).toEqual([["status"], ["oblast_name"]]);
    expect(calls[0].filters).toEqual([]);
    expect(calls[1].filters).toHaveLength(1);
  });

  it("names the RESOURCE in every request, so two pages cannot share a cache entry", async () => {
    renderHook(
      () =>
        useRegistryFacets("persons", { a: { columns: ["role"], filters: [] } }),
      { wrapper: wrap },
    );
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].resource).toBe("persons");
  });

  it("⚠️ a failed response is an ERROR, not an empty success", async () => {
    // With `staleTime: Infinity` a resolved `{}` is cached as a SUCCESS for the session, so one
    // 500 blanks every picker permanently and React Query never retries because nothing failed.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 500,
            statusText: "boom",
          }) as unknown as Response,
      ),
    );
    const { result } = renderHook(
      () =>
        useRegistryFacets("companies", {
          a: { columns: ["status"], filters: [] },
        }),
      { wrapper: wrap },
    );
    // Consumers still see an empty map in the meantime — no call site changes.
    await waitFor(() => expect(result.current.bySpec.a).toEqual({}));
    expect(result.current.merged).toEqual({});
  });

  it("asks for the server's maximum, so a vocabulary is not silently truncated", async () => {
    // runDbFacets orders by COUNT, so a short limit loses the RAREST members — exactly the
    // options a reader is least likely to notice missing.
    renderHook(
      () =>
        useRegistryFacets("companies", {
          a: { columns: ["obshtina_code"], filters: [] },
        }),
      { wrapper: wrap },
    );
    await waitFor(() => expect(calls.length).toBe(1));
    expect((calls[0] as unknown as { limit: number }).limit).toBe(500);
  });
});
