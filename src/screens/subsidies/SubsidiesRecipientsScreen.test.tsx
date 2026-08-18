// /subsidies/recipients — the page the hub's inline top-recipient list moved to.
//
// This file re-homes the coverage step 7 displaced. The hub's own test used to assert
// `getByText("ЕКО ФЕРМА ООД")` against a list the hub rendered from the overview payload; the
// ranking is now a server-side DbDataTable on this page, so the row DATA belongs to the table's
// own tests and what is left here — and only here — is the wiring around it:
//
//   • the resource and the scope column the table is mounted with. Get either wrong and the
//     page renders „Няма резултати" for every scope, or (worse) unions every partition and
//     multiplies the money. Neither raises.
//   • the name column deep-links to /farm/:eik. That link is the module's whole reason for
//     ranking recipients — it is what puts a farm's subsidies beside its contracts and grants.
//   • the scope label the reader reads the ranking under.
//
// The four render states are NOT tested here: the seven sub-pages that offer a scope share
// `AgriScopeFallback`, and it is tested once in AgriScopeGate.test.tsx — its RENDERING there,
// its DERIVATION in useAgriScope.test.tsx.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import type { AgriIndexFile } from "@/data/agri/types";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import type { RecipientRow } from "./SubsidiesRecipientsScreen";

// The table is captured rather than rendered: what this file checks is how it is MOUNTED.
// Its columns are then exercised by hand below, which is the only way to reach a `cell`
// renderer without standing up the whole server-side table and its fetch.
const mounted = vi.hoisted(() => ({
  props: null as null | {
    resource: string;
    scope?: { col: string; val: string };
    columns: DataTableColumnDef<RecipientRow, unknown>[];
    defaultSort?: { id: string; desc: boolean }[];
  },
}));
vi.mock("@/ux/data_table/DbDataTable", () => ({
  DbDataTable: (p: NonNullable<typeof mounted.props>) => {
    mounted.props = p;
    return <div data-testid="db-table" />;
  },
}));

// Driven by a SCOPE, not by a year. Deriving `scope` from `scopeYear` made
// `scopeYear = null` yield „ns", so the „all years" test asked for the LATEST-year
// partition while asserting the label said „All years" — the „shows one window and
// counts another" state, built by hand and green.
const hook = vi.hoisted(() => ({
  scope: "y:2025" as "ns" | "all" | `y:${number}`,
  scopeYear: 2025 as number | null,
}));
vi.mock("@/data/agri/useAgriScope", async () => {
  const actual = await vi.importActual<
    typeof import("@/data/agri/useAgriScope")
  >("@/data/agri/useAgriScope");
  return {
    ...actual,
    useAgriScope: () => ({
      scope: hook.scope,
      setScope: vi.fn(),
      data: overview(hook.scopeYear),
      state: "ready" as const,
      paused: false,
      refetch: vi.fn(),
    }),
  };
});
// `Title` is NOT mocked: it renders an h1 plus SEO, and SEO is useEffect + useLocation —
// no provider, no network. The sibling SubsidiesPlacesScreen.test.tsx renders it unmocked
// too, and stubbing it here would drop the description prop from the render under test for
// no benefit.

const { SubsidiesRecipientsScreen } =
  await import("./SubsidiesRecipientsScreen");

const at = (url = "/subsidies/recipients") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <TooltipProvider>
        <Routes>
          <Route
            path="/subsidies/recipients"
            element={<SubsidiesRecipientsScreen />}
          />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );

/** A COMPLETE AgriIndexFile, so a new read on the screen fails to compile rather than
 *  silently exercising `undefined`. The double cast this replaces disabled the only check
 *  the fixture existed to give. */
const overview = (scopeYear: number | null): AgriIndexFile =>
  ({
    generatedFrom: "ДФЗ (тест)",
    bgnPerEur: 1.95583,
    scope: scopeYear ? String(scopeYear) : "all",
    scopeYear,
    years: [2025, 2024],
    latestYear: 2025,
    headline: {
      totalEur: 1_000_000,
      entityEur: 600_000,
      individualEur: 400_000,
      entityCount: 10,
      individualCount: 20,
      topScheme: null,
    },
    totalsByYear: [],
    byScheme: [],
    byOblast: [],
    concentration: {
      year: 2025,
      scope: "2025",
      basis: "legal-entities",
      entityCount: 10,
      entityEur: 600_000,
      top1Share: 10,
      top10Share: 50,
      top100Share: 90,
      top1000Share: 100,
      lorenz: [],
    },
    topRecipients: [],
  }) as AgriIndexFile;

const ROW: RecipientRow = {
  eik: "111560777",
  name: "ЕКО ФЕРМА ООД",
  oblast: "Пловдив",
  paymentCount: "42",
  totalEur: 1_234_567,
};

/** The scope label, read from the region that owns it. A bare getByText(/All years/) also
 *  matches the real ScopeControl's own trigger — it resolves to one node today only because
 *  i18next is uninitialised under vitest and `t()` returns the key. Anchoring here means the
 *  day someone initialises i18n in vitest.setup.ts this file does not break for a reason
 *  nobody changed. */
const label = () =>
  document.querySelector("[data-og='subsidies-recipients'] p")?.textContent ??
  "";

beforeEach(() => {
  mounted.props = null;
  hook.scope = "y:2025";
  hook.scopeYear = 2025;
});

describe("SubsidiesRecipientsScreen", () => {
  it("mounts the ranking on the scope-keyed resource, through `scope`", () => {
    at("/subsidies/recipients?pscope=y:2025");
    expect(screen.getByTestId("db-table")).toBeInTheDocument();
    expect(mounted.props?.resource).toBe("agri_recipients");
    // Through `scope`, NOT extraFilters. `agri_recipients` declares
    // defaultScope { scope_key: 'all' }, and buildWhere ANDs a same-column extraFilter with
    // that default — the two then contradict and every year but 'all' renders empty.
    expect(mounted.props?.scope).toEqual({
      col: "scope_key",
      val: "2025",
    });
    // Biggest first: this page IS the ranking.
    expect(mounted.props?.defaultSort).toEqual([
      { id: "total_eur", desc: true },
    ]);
  });

  it("deep-links each recipient to its own farm page", () => {
    // The assertion the hub's test used to carry as `getByText("ЕКО ФЕРМА ООД")`. The row is
    // no longer rendered by this component, so the column's own cell renderer is exercised
    // instead — which is the part this file owns and the part that carries the link.
    at();
    const name = mounted.props?.columns.find((c) => c.id === "name");
    expect(name, "the recipient column is gone").toBeTruthy();
    const cell = name!.cell as (a: {
      row: { original: RecipientRow };
    }) => ReactNode;
    render(<MemoryRouter>{cell({ row: { original: ROW } })}</MemoryRouter>);
    const link = screen.getByRole("link", { name: "ЕКО ФЕРМА ООД" });
    expect(link.getAttribute("href")).toBe("/farm/111560777");
  });

  it("names the window the ranking is for", () => {
    at("/subsidies/recipients?pscope=y:2025");
    expect(label()).toMatch(/Financial year 2025/);
  });

  it("labels the all-years scope as all years, AND asks for that partition", () => {
    hook.scope = "all";
    hook.scopeYear = null;
    at("/subsidies/recipients?pscope=all");
    expect(label()).toMatch(/All years/);
    expect(mounted.props?.scope).toEqual({ col: "scope_key", val: "all" });
  });

  it("the default scope asks for the '' partition, not for a year", () => {
    // `agriScopeToKey("ns")` → "" — the latest-financial-year partition, and the state
    // every reader who arrives with no query param lands in. The empty string is the value
    // most at risk from a truthiness check somewhere in the chain, and nothing else pins it.
    hook.scope = "ns";
    hook.scopeYear = 2025;
    at("/subsidies/recipients");
    expect(mounted.props?.scope).toEqual({ col: "scope_key", val: "" });
    expect(label()).toMatch(/Financial year 2025/);
  });
});
