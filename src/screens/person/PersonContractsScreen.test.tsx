// The standalone person contracts browser's REQUEST SHAPE — the one thing worth pinning,
// since everything visible is server-produced. Two properties that fail SILENTLY (the page
// keeps rendering, with the wrong rows):
//
//   1. NAME vs SLUG. `:name` is a slug for a public figure and a raw TR name for the fallback
//      persons. The browser must scope through the column whose EIK derivation matches — a
//      profile hit → contractor_of_person_slug, a miss → contractor_of_person_name. Choosing
//      wrong scopes to nothing (a slug folded through translit_bg_latin matches no officer).
//   2. THE COUNT BASIS. `not_consortium_member` must ride the scope so the footer count matches
//      the person_procurement headline (which excludes €0 consortium-member rows).
//
// Fetch is stubbed (vitest.setup.ts makes an unstubbed fetch throw).

import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PersonContractsScreen } from "./PersonContractsScreen";

type Col = { id: string; value?: unknown; min?: unknown; max?: unknown };
const tableRequests: Array<{ filters: { columns: Col[] } }> = [];
const facetRequests: Array<{ fixedFilters?: Col[] }> = [];

// The profile the stubbed /api/db/person-profile returns for this render.
let profileResponse: unknown = null;

beforeEach(() => {
  tableRequests.length = 0;
  facetRequests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/db/person-profile"))
        return new Response(JSON.stringify(profileResponse), { status: 200 });
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
          <Routes>
            <Route
              path="/person/:name/contracts"
              element={<PersonContractsScreen />}
            />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const columnsOf = (i = 0) => tableRequests[i]?.filters?.columns ?? [];
const filterFor = (id: string, i = 0) => columnsOf(i).find((c) => c.id === id);

describe("PersonContractsScreen", () => {
  it("scopes a TR-only person (profile miss) through contractor_of_person_name", async () => {
    profileResponse = null; // no public-figure profile → name-fold path
    renderAt("/person/%D0%98%D0%92%D0%90%D0%9D/contracts"); // "ИВАН"
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));

    expect(filterFor("contractor_of_person_name")?.value).toBe("ИВАН");
    expect(filterFor("contractor_of_person_slug")).toBeUndefined();
    // Count basis matches person_procurement.
    expect(filterFor("not_consortium_member")?.value).toBe("member");
    expect(filterFor("tag")?.value).toEqual(["contract"]);
  });

  it("scopes a public figure (profile hit) through contractor_of_person_slug", async () => {
    profileResponse = { slug: "ivan-petrov-abc123", name: "Иван Петров" };
    renderAt("/person/ivan-petrov-abc123/contracts");
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));

    expect(filterFor("contractor_of_person_slug")?.value).toBe(
      "ivan-petrov-abc123",
    );
    expect(filterFor("contractor_of_person_name")).toBeUndefined();
    expect(filterFor("not_consortium_member")?.value).toBe("member");
  });

  it("defaults to ALL years — no date filter", async () => {
    profileResponse = null;
    renderAt("/person/%D0%98%D0%92%D0%90%D0%9D/contracts");
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));
    expect(filterFor("date")).toBeUndefined();
  });

  it("narrows to a calendar year via ?pscope=y:2024 (inclusive bounds)", async () => {
    profileResponse = null;
    renderAt("/person/%D0%98%D0%92%D0%90%D0%9D/contracts?pscope=y:2024");
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));
    const date = filterFor("date", tableRequests.length - 1);
    expect(date?.min).toBe("2024-01-01");
    expect(date?.max).toBe("2024-12-31");
  });

  it("scopes the FACETS by the same person + basis as the rows", async () => {
    profileResponse = null;
    renderAt("/person/%D0%98%D0%92%D0%90%D0%9D/contracts");
    await waitFor(() => expect(facetRequests.length).toBeGreaterThan(0));
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

  it("fires NO table request until the profile resolves, then uses the SLUG scope", async () => {
    // The loading gate is the single most important correctness property: the browser must
    // stay unmounted until we know slug-vs-name, or a public figure's slug gets folded as a
    // name and matches nothing. Defer the profile and prove nothing fires meanwhile.
    let resolveProfile!: (r: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes("/api/db/person-profile"))
          return new Promise<Response>((res) => (resolveProfile = res));
        if (u.includes("/api/db/table")) {
          const q = new URL(u, "http://x").searchParams.get("q");
          if (q) tableRequests.push(JSON.parse(q));
          return new Response(
            JSON.stringify({ rows: [], total: 0, aggregates: {} }),
            { status: 200 },
          );
        }
        if (u.includes("procurement-ngo-foreign"))
          return new Response(JSON.stringify({ entries: [] }), { status: 200 });
        return new Response(JSON.stringify({ facets: {} }), { status: 200 });
      }),
    );
    renderAt("/person/ivan-petrov-abc123/contracts");
    await new Promise((r) => setTimeout(r, 0));
    expect(tableRequests.length).toBe(0); // browser not mounted while profile pending

    resolveProfile(
      new Response(
        JSON.stringify({ slug: "ivan-petrov-abc123", name: "Иван" }),
        { status: 200 },
      ),
    );
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));
    expect(filterFor("contractor_of_person_slug")?.value).toBe(
      "ivan-petrov-abc123",
    );
    expect(filterFor("contractor_of_person_name")).toBeUndefined();
  });

  it("clamps an off-range ?pscope year to ALL (picker never blanks)", async () => {
    // y:2005 is before SCOPE_FIRST_YEAR — the shared resolveScope clamps it, so the page
    // falls back to all-years (no date filter) rather than a blank Radix Select over a
    // window nothing else agrees with.
    profileResponse = null;
    renderAt("/person/%D0%98%D0%92%D0%90%D0%9D/contracts?pscope=y:2005");
    await waitFor(() => expect(tableRequests.length).toBeGreaterThan(0));
    expect(filterFor("date", tableRequests.length - 1)).toBeUndefined();
  });
});
