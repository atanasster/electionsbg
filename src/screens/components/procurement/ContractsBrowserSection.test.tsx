// The shared contracts-browser body's PROP → REQUEST-SHAPE contract, tested directly so a
// regression in a caller-specific prop is caught independent of any one caller (the settlement
// and person wrappers each test their own scope, but not each other's).
//
// Two invariants every caller relies on, both silent if broken:
//   • an arbitrary multi-filter `scope` (semi-join + always-on predicate) must reach BOTH the
//     table's fixedFilters AND every facet, so the KPI strip describes the rows below it;
//   • a null `dateWindow` lower bound must emit NO date filter (full corpus).
//
// Fetch is stubbed (vitest.setup.ts makes an unstubbed fetch throw).

import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContractsBrowserSection } from "./ContractsBrowserSection";
import type { DbColumnFilter } from "@/ux/data_table/DbDataTable";

type Col = { id: string; value?: unknown; min?: unknown; max?: unknown };
const tableRequests: Array<{ filters: { columns: Col[] } }> = [];
const facetRequests: Array<{ fixedFilters?: Col[] }> = [];

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
        return new Response(
          JSON.stringify({
            rows: [],
            total: 0,
            totalExact: true,
            page: 0,
            pageSize: 25,
            aggregates: { sumAmountEur: 0, count: 0 },
          }),
          { status: 200 },
        );
      }
      if (u.includes("/api/db/facets")) {
        const q = new URL(u, "http://x").searchParams.get("q");
        if (q) facetRequests.push(JSON.parse(q));
        return new Response(JSON.stringify({ facets: {} }), { status: 200 });
      }
      // useNgoForeignFundedByEik reads `.entries` off the JSON, and [].entries is the array
      // iterator FUNCTION — so this route must return an object, not a bare array.
      if (u.includes("procurement-ngo-foreign"))
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const COLUMNS = ["date", "awarder_name", "amount_eur"] as const;

const renderWith = (
  scope: DbColumnFilter[],
  dateWindow: [string | null, string | null],
) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        })
      }
    >
      <MemoryRouter initialEntries={["/x"]}>
        <TooltipProvider>
          <ContractsBrowserSection
            scope={scope}
            dateWindow={dateWindow}
            resetKey="k"
            columns={[...COLUMNS]}
          />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const columnsOf = (i = 0) => tableRequests[i]?.filters?.columns ?? [];
const filterFor = (id: string, i = 0) => columnsOf(i).find((c) => c.id === id);

describe("ContractsBrowserSection", () => {
  it("threads a multi-filter scope into BOTH fixedFilters and every facet", async () => {
    const scope: DbColumnFilter[] = [
      { id: "contractor_of_person_name", value: "ИВАН" },
      { id: "not_consortium_member", value: "member" },
    ];
    renderWith(scope, [null, null]);
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));
    await waitFor(() => expect(facetRequests.length).toBeGreaterThan(0));

    // table
    expect(filterFor("contractor_of_person_name")?.value).toBe("ИВАН");
    expect(filterFor("not_consortium_member")?.value).toBe("member");
    expect(filterFor("tag")?.value).toEqual(["contract"]);
    // every facet
    for (const req of facetRequests) {
      const fixed = req.fixedFilters ?? [];
      expect(
        fixed.find((f) => f.id === "contractor_of_person_name")?.value,
      ).toBe("ИВАН");
      expect(fixed.find((f) => f.id === "not_consortium_member")?.value).toBe(
        "member",
      );
    }
  });

  it("emits no date filter when the window lower bound is null", async () => {
    renderWith([{ id: "awarder_ekatte", value: "10135" }], [null, null]);
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));
    expect(filterFor("date")).toBeUndefined();
  });

  it("emits an INCLUSIVE date range from the window pair", async () => {
    renderWith(
      [{ id: "awarder_ekatte", value: "10135" }],
      ["2024-01-01", "2024-12-31"],
    );
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));
    const date = filterFor("date");
    expect(date?.min).toBe("2024-01-01");
    expect(date?.max).toBe("2024-12-31");
  });
});
