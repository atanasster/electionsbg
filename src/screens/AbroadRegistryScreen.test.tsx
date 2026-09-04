// Component guard for /declarations/abroad.
//
// Every test here is a way the page could publish a figure the corpus does not support. The
// two that shipped and were caught in review are (1) and (2): the route's missing-migration
// sentinel is an ARRAY (truthy), and a stamped-but-empty corpus returns a well-formed object
// whose money keys are all NULL — both rendered an empty amount above „— % от " with no
// number and no denominator.
//
// Hermetic: fetch stubbed, DbDataTable mocked to its props.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AbroadHoldingRow } from "@/data/persons/useAbroadRegistry";
import type { DataTableColumnDef } from "@/ux/data_table/utils";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length ? `${k}:${JSON.stringify(o)}` : k,
    i18n: { language: "bg" },
  }),
}));
vi.mock("react-router-dom", () => ({
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/ux/Title", () => ({
  Title: ({ children }: { children?: ReactNode }) => <h1>{children}</h1>,
}));
vi.mock("@/screens/components/DeclarationsBreadcrumb", () => ({
  DeclarationsBreadcrumb: () => null,
}));
// Captures what the page asks the registry engine for, without a network round trip.
// `columns` is captured too so a column's own `cell` renderer — e.g. the `is_spouse`
// "Притежател" column — can be exercised directly, the same way DbDataTable itself would
// call it per row, without needing the real registry engine underneath.
const seen: { scope?: unknown; extraFilters?: unknown; columns?: unknown } = {};
vi.mock("@/ux/data_table/DbDataTable", () => ({
  DbDataTable: (p: Record<string, unknown>) => {
    seen.scope = p.scope;
    seen.extraFilters = p.extraFilters;
    seen.columns = p.columns;
    return (
      <div data-testid="table">{String((p.resource as string) ?? "")}</div>
    );
  },
}));

import { AbroadRegistryScreen } from "./AbroadRegistryScreen";

const stub = (body: unknown, ok = true) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      json: async () => body,
    })) as unknown as typeof fetch,
  );

beforeEach(() => {
  seen.scope = undefined;
  seen.extraFilters = undefined;
  seen.columns = undefined;
});
afterEach(() => vi.unstubAllGlobals());

const card = () => screen.queryByText(/^abroad_headline/);

describe("AbroadRegistryScreen — the headline never renders without its denominator", () => {
  it("renders the card when the payload is complete", async () => {
    stub({
      peopleAbroad: 628,
      rowsAbroad: 1022,
      eurAbroad: 46815104,
      eurInScope: 799027521,
      pctOfInScope: 5.9,
      unresolvedRows: 94,
      unvaluedRowsAbroad: 0,
      countryNamedRows: 144,
      eurCountryNamed: 4288152,
    });
    render(<AbroadRegistryScreen />);
    await waitFor(() => expect(card()).toBeInTheDocument());
    // The denominator is IN the sentence, not a footnote.
    expect(card()!.textContent).toContain("799");
  });

  // (1) The route's missing-migration sentinel. `[] ?? null` is `[]`, which is truthy.
  it("renders no card when the route degrades to the array sentinel", async () => {
    stub([]);
    render(<AbroadRegistryScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("table")).toBeInTheDocument(),
    );
    expect(card()).not.toBeInTheDocument();
  });

  // (2) 169 applied, corpus not stamped: sum() is NULL over an empty set, so the object is
  // well-formed and every money key is null. CLAUDE.md calls this state INERT and it is the
  // one person_abroad.data.test.ts skips on.
  it("renders no card when the corpus is unstamped and every money key is null", async () => {
    stub({
      peopleAbroad: 0,
      rowsAbroad: 0,
      eurAbroad: null,
      eurInScope: null,
      pctOfInScope: null,
      unresolvedRows: 0,
      unvaluedRowsAbroad: 0,
      countryNamedRows: 0,
      eurCountryNamed: null,
    });
    render(<AbroadRegistryScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("table")).toBeInTheDocument(),
    );
    expect(card()).not.toBeInTheDocument();
  });

  it("renders no card on a server error", async () => {
    stub("<html>500</html>", false);
    render(<AbroadRegistryScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("table")).toBeInTheDocument(),
    );
    expect(card()).not.toBeInTheDocument();
  });
});

describe("AbroadRegistryScreen — scope", () => {
  // The default is a CORRECTNESS property: an unscoped query unions both buckets, 3.73x the
  // rows and 4.06x the money.
  it("asks for the latest scope by default", async () => {
    stub(null);
    render(<AbroadRegistryScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("table")).toBeInTheDocument(),
    );
    expect(seen.scope).toEqual({ col: "scope", val: "latest" });
  });

  it("sends no filters until a facet is chosen", async () => {
    stub(null);
    render(<AbroadRegistryScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("table")).toBeInTheDocument(),
    );
    expect(seen.extraFilters).toEqual([]);
  });
});

// docs/plans/declaration-holder-self-fold-v1.md T0 — the "Притежател" column must print
// the register's own holder text where there is one, not the bare neutral label that
// makes a false is_spouse flag an unqualified claim about a named public figure.
describe("AbroadRegistryScreen — holder column", () => {
  const holderCell = (row: Partial<AbroadHoldingRow>) => {
    const columns = seen.columns as DataTableColumnDef<
      AbroadHoldingRow,
      unknown
    >[];
    const col = columns.find((c) => c.id === "is_spouse");
    if (typeof col?.cell !== "function")
      throw new Error("is_spouse column has no cell renderer");
    return col.cell({ row: { original: row } } as never) as ReactNode;
  };

  it("renders the register's own holder text when is_spouse is true and holderName is set", async () => {
    stub(null);
    render(<AbroadRegistryScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("table")).toBeInTheDocument(),
    );
    render(
      <>{holderCell({ isSpouse: true, holderName: "Иван Стоянов Иванов" })}</>,
    );
    expect(screen.getByText("Иван Стоянов Иванов")).toBeInTheDocument();
    expect(screen.queryByText("pp_decl_holder_other")).not.toBeInTheDocument();
  });

  it("falls back to the neutral label when is_spouse is true but no holder name is given", async () => {
    stub(null);
    render(<AbroadRegistryScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("table")).toBeInTheDocument(),
    );
    render(<>{holderCell({ isSpouse: true, holderName: null })}</>);
    expect(screen.getByText("pp_decl_holder_other")).toBeInTheDocument();
  });

  it("labels the declarant's own row, not 'other holder', when is_spouse is false", async () => {
    stub(null);
    render(<AbroadRegistryScreen />);
    await waitFor(() =>
      expect(screen.getByTestId("table")).toBeInTheDocument(),
    );
    render(<>{holderCell({ isSpouse: false, holderName: null })}</>);
    expect(screen.getByText("abroad_holder_self")).toBeInTheDocument();
  });
});
