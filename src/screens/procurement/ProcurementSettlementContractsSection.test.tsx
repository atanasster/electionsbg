// The settlement contracts browser's REQUEST SHAPE.
//
// Everything visible about this section is produced by the server, so the only thing worth
// pinning in a component test is what it asks for. Two properties, both of which fail
// silently if broken — the page keeps rendering, with the wrong rows:
//
//   1. THE PLACE. It must scope through `awarder_ekatte` (the semi-join) and never resolve
//      the buyer set client-side. Losing the filter serves the national corpus under one
//      settlement's heading, at a 200.
//   2. THE WINDOW, and specifically its UPPER BOUND. This table's `date` filter is
//      INCLUSIVE while the KPI cards above it read a HALF-OPEN endpoint, so the table has
//      to stop a day short. Passing useScopeWindow's exclusive `to` here instead of
//      scopeRange's inclusive one admits 1 January of the next year into a year view — one
//      day of contracts that the total above disagrees with, and nothing errors.
//
// Fetch is stubbed (vitest.setup.ts makes an unstubbed fetch throw).

import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProcurementSettlementContractsSection } from "./ProcurementSettlementContractsSection";

const tableResponse = {
  rows: [],
  total: 0,
  totalExact: true,
  page: 0,
  pageSize: 25,
  aggregates: { sumAmountEur: 0, count: 0 },
};

/** Every /api/db/table request body this render issued. */
const tableRequests: Array<{
  filters: {
    columns: Array<{
      id: string;
      value?: unknown;
      min?: unknown;
      max?: unknown;
    }>;
  };
}> = [];

/** Every /api/db/facets request body — the KPI strip's half of the page. */
const facetRequests: Array<{
  fixedFilters?: Array<{ id: string; value?: unknown; max?: unknown }>;
  filters?: Array<{ id: string; value?: unknown }>;
}> = [];

beforeEach(() => {
  tableRequests.length = 0;
  facetRequests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/db/table")) {
        const q = new URL(u, "http://x").searchParams.get("q");
        if (q) tableRequests.push(JSON.parse(q));
        return new Response(JSON.stringify(tableResponse), { status: 200 });
      }
      if (u.includes("/api/db/facets")) {
        const q = new URL(u, "http://x").searchParams.get("q");
        if (q) facetRequests.push(JSON.parse(q));
        return new Response(JSON.stringify({ facets: {} }), { status: 200 });
      }
      // cpv-catalog, procurement-ngo-foreign, …
      return new Response(JSON.stringify([]), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const renderAt = (url: string) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <MemoryRouter initialEntries={[url]}>
        <TooltipProvider>
          <ProcurementSettlementContractsSection ekatte="10135" />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const columnsOf = (i = 0) => tableRequests[i]?.filters?.columns ?? [];
const filterFor = (id: string, i = 0) => columnsOf(i).find((c) => c.id === id);

describe("ProcurementSettlementContractsSection", () => {
  it("scopes the table through the awarder_ekatte semi-join", async () => {
    renderAt("/procurement/settlement/10135?pscope=all");
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));

    expect(filterFor("awarder_ekatte")?.value).toBe("10135");
    // The place must never be expanded into an EIK list client-side: that would be a
    // request-URL-length problem and a round-trip the semi-join exists to avoid.
    expect(filterFor("awarder_eik")).toBeUndefined();
    expect(filterFor("tag")?.value).toEqual(["contract"]);
  });

  it("sends no date filter on the full-corpus scope", async () => {
    renderAt("/procurement/settlement/10135?pscope=all");
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));
    expect(filterFor("date")).toBeUndefined();
  });

  it("stops a day SHORT of the next year on a calendar-year scope", async () => {
    // The whole point: 2024-12-31, not 2025-01-01. The table filter is `date <= max`,
    // so the exclusive bound would pull one extra day in and desynchronise the row
    // count from the total rendered above it.
    renderAt("/procurement/settlement/10135?pscope=y:2024");
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));

    const date = filterFor("date");
    expect(date?.min).toBe("2024-01-01");
    expect(date?.max).toBe("2024-12-31");
  });

  it("passes the risk grade filter to the server, not the page", async () => {
    // ?grade filters the whole settlement's contract set via the server-side index —
    // filtering the loaded page instead would silently show "3 of 25" as the total.
    renderAt("/procurement/settlement/10135?pscope=all&grade=D,E,F");
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));
    expect(filterFor("risk_grade")?.value).toEqual(["D", "E", "F"]);
  });

  it("keeps the place filter under every other active filter", async () => {
    // A filter combination must never REPLACE the scope — the settlement is the page.
    renderAt(
      "/procurement/settlement/10135?pscope=y:2024&single=1&grade=F&cpv=45",
    );
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));

    const last = tableRequests.length - 1;
    expect(filterFor("awarder_ekatte", last)?.value).toBe("10135");
    expect(filterFor("date", last)?.max).toBe("2024-12-31");
    expect(filterFor("number_of_tenderers", last)).toBeDefined();
    expect(filterFor("risk_grade", last)?.value).toEqual(["F"]);
    expect(filterFor("cpv", last)?.value).toBe("45");
  });

  it("scopes the FACETS by the same place and window as the rows", async () => {
    // TEST-001, and the hazard this file's header names: the KPI strip and the mix bar
    // are computed by /api/db/facets, not by the table. If the place or the window
    // reaches one and not the other, the strip describes a different set than the rows
    // beneath it — same page, two answers, nothing failing.
    renderAt("/procurement/settlement/10135?pscope=y:2024");
    await waitFor(() => expect(facetRequests.length).toBeGreaterThan(0));

    for (const req of facetRequests) {
      const fixed = req.fixedFilters ?? [];
      const place = fixed.find((f) => f.id === "awarder_ekatte");
      const date = fixed.find((f) => f.id === "date");
      expect(place?.value).toBe("10135");
      expect(date?.max).toBe("2024-12-31");
    }
  });

  it("uses the parliament window on the default scope", async () => {
    // TEST-002. y:2024's bounds are string literals; the `ns` branch is the only one
    // scopeRange COMPUTES (it walks elections.json and subtracts a day), so it is the
    // only one that can be wrong in a way the other cases would not reveal.
    renderAt("/procurement/settlement/10135");
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));

    const date = filterFor("date");
    // The most recent parliament is open-ended, so a max may legitimately be absent —
    // but a min must always be present, and neither bound may be the raw election day
    // of the NEXT election (that would be the exclusive bound, one day too many).
    expect(date?.min).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    if (date?.max !== undefined) {
      expect(date.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(date.max).not.toBe(date.min);
    }
  });

  it("translates ?proc into a procurement_method filter", async () => {
    // TEST-003. The bucket is a UI vocabulary; the server filters raw method strings,
    // so the translation happens in useContractsAnalytics and arrives as methodF. With
    // no facet data the bucket resolves to nothing — assert the request still carries
    // the place, i.e. an unknown bucket narrows rather than silently widening.
    renderAt("/procurement/settlement/10135?pscope=all&proc=open");
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));
    const last = tableRequests.length - 1;
    expect(filterFor("awarder_ekatte", last)?.value).toBe("10135");
  });
});
