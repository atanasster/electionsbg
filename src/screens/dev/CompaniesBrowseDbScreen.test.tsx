// /companies — what each row CLAIMS about a company.
//
// Three assertions carried over from the retired OfficialCompaniesScreen's own test (same
// `cell` logic, ported into this screen's compound name/evidence/money cells):
//
//   • a company reached only through WITHDRAWN registry filings must read as FORMER.
//   • the registry and declared-stake arms are different evidence and must be
//     distinguishable, not merged — and the whole evidence cell must render "—" for a
//     company that isn't officially-linked at all (this screen's population is far wider
//     than the retired page's, so "no evidence" is now the common case, not the exception).
//   • the money column is a broad basis, and €0 must read as "none", never as blank/unknown.
//
// `DbDataTable` is stubbed rather than exercised: it is separately tested, it fetches, and
// what this file is about is the column definitions the screen hands it. The stub renders
// every row through those definitions, so a broken `cell` still fails here.

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { bgCorpus as bg } from "@/locales/allKeys";
import type { CompanyBrowseRow } from "./CompaniesBrowseDbScreen";

const dict = bg as Record<string, string>;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "bg" },
    t: (k: string) => dict[k] ?? k,
  }),
}));

const rows = vi.hoisted(() => ({ current: [] as unknown[] }));
/** What the ENGINE actually returns: buildAggSelect aliases every aggregate camelCase. */
const AGG = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
  total: 0,
}));

// A stub that honours the contract the screen depends on: it receives `columns` and renders
// each row's cells. Anything the screen gets wrong in a `cell` shows up in the DOM. The stub
// MUST render renderAggregates too — see OfficialCompaniesScreen's own history, where a stub
// exercising fewer props than the component uses certified the untested half.
vi.mock("@/ux/data_table/DbDataTable", () => ({
  DbDataTable: ({
    columns,
    resource,
    renderAggregates,
  }: {
    resource: string;
    columns: {
      id: string;
      cell?: (ctx: { row: { original: unknown } }) => React.ReactNode;
    }[];
    renderAggregates?: (
      agg: Record<string, unknown>,
      total: number,
      exact: boolean,
    ) => React.ReactNode;
  }) => (
    <div data-testid="table" data-resource={resource}>
      <div data-testid="footer">
        {renderAggregates
          ? renderAggregates(AGG.current, AGG.total, true)
          : null}
      </div>
      {rows.current.map((r, i) => (
        <div key={i} data-testid="row">
          {columns.map((c) => (
            <div key={c.id} data-testid={`cell-${c.id}`}>
              {c.cell ? c.cell({ row: { original: r } }) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

const { CompaniesBrowseDbScreen } = await import("./CompaniesBrowseDbScreen");

const row = (over: Partial<CompanyBrowseRow>): CompanyBrowseRow => ({
  uic: "204361427",
  name: "ПРИМЕР ООД",
  legalForm: "OOD",
  seat: "БЪЛГАРИЯ, гр. София",
  status: "active",
  entityClass: "company",
  oblastName: "София (столица)",
  obshtinaCode: "SFO",
  publicMoneyEur: 0,
  contractorTotalEur: null,
  contractCount: 0,
  isMpTied: false,
  personCount: 0,
  hasRegistryLink: false,
  hasDeclaredStake: false,
  hasCurrentRole: false,
  isOfficialLinked: false,
  hasSignal: false,
  ...over,
});

const draw = (data: CompanyBrowseRow[]) => {
  rows.current = data;
  return render(
    <MemoryRouter>
      <CompaniesBrowseDbScreen />
    </MemoryRouter>,
  );
};

const evidence = () => screen.getByTestId("cell-evidence");

describe("CompaniesBrowseDbScreen — the server-side resource", () => {
  it("reads rows from the `companies` resource, not the retired official_companies one", () => {
    draw([row({})]);
    expect(screen.getByTestId("table")).toHaveAttribute(
      "data-resource",
      "companies",
    );
  });
});

describe("CompaniesBrowseDbScreen — the evidence a row claims", () => {
  it("renders — for a company that is not officially-linked at all", () => {
    // The common case on this wider browse: most companies carry no political-link evidence.
    draw([row({ isOfficialLinked: false })]);
    expect(evidence().textContent).toBe("—");
  });

  it("labels a registry link and a declared stake separately", () => {
    draw([
      row({
        isOfficialLinked: true,
        hasRegistryLink: true,
        hasDeclaredStake: true,
        hasCurrentRole: true,
      }),
    ]);
    const cell = evidence();
    expect(
      within(cell).getByText(dict.oc_evidence_registry),
    ).toBeInTheDocument();
    expect(
      within(cell).getByText(dict.oc_evidence_declared),
    ).toBeInTheDocument();
  });

  it("marks a company whose every registry filing was withdrawn as FORMER", () => {
    draw([
      row({
        isOfficialLinked: true,
        hasRegistryLink: true,
        hasCurrentRole: false,
      }),
    ]);
    expect(
      within(evidence()).getByText(dict.oc_evidence_former),
    ).toBeInTheDocument();
  });

  it("does NOT mark a current registry role as former", () => {
    draw([
      row({
        isOfficialLinked: true,
        hasRegistryLink: true,
        hasCurrentRole: true,
      }),
    ]);
    expect(
      within(evidence()).queryByText(dict.oc_evidence_former),
    ).not.toBeInTheDocument();
  });

  it("never marks a stake-only company former — a declaration cannot be withdrawn", () => {
    draw([
      row({
        isOfficialLinked: true,
        hasRegistryLink: false,
        hasDeclaredStake: true,
        hasCurrentRole: false,
      }),
    ]);
    const cell = evidence();
    expect(
      within(cell).queryByText(dict.oc_evidence_former),
    ).not.toBeInTheDocument();
    expect(
      within(cell).getByText(dict.oc_evidence_declared),
    ).toBeInTheDocument();
  });
});

describe("CompaniesBrowseDbScreen — what kind of organisation each row is", () => {
  it("names a non-company kind rather than calling it a фирма", () => {
    draw([row({ entityClass: "ngo_assoc", name: "БЪЛГАРСКИ ЧЕРВЕН КРЪСТ" })]);
    expect(
      within(screen.getByTestId("cell-name")).getByText(dict.oc_kind_ngo_assoc),
    ).toBeInTheDocument();
  });

  it("does not label an ordinary company with a kind", () => {
    draw([row({ entityClass: "company" })]);
    expect(
      within(screen.getByTestId("cell-name")).queryByText(dict.oc_kind_company),
    ).not.toBeInTheDocument();
  });

  it("translates a foreign_branch entity class rather than printing the raw code", () => {
    draw([row({ entityClass: "foreign_branch" })]);
    const cell = screen.getByTestId("cell-name");
    expect(
      within(cell).getByText(dict.oc_kind_foreign_branch),
    ).toBeInTheDocument();
    expect(cell.textContent).not.toMatch(/foreign_branch/);
  });
});

describe("CompaniesBrowseDbScreen — the row's other columns", () => {
  it("links the company by EIK and prints the identifier beside it", () => {
    draw([row({ uic: "204361427", name: "ПРИМЕР ООД" })]);
    const cell = screen.getByTestId("cell-name");
    expect(within(cell).getByRole("link")).toHaveAttribute(
      "href",
      "/company/204361427",
    );
    expect(within(cell).getByText("204361427")).toBeInTheDocument();
  });

  it("renders €0 public money as none, not as an amount", () => {
    draw([row({ publicMoneyEur: 0 })]);
    expect(screen.getByTestId("cell-public_money_eur").textContent).toBe("—");
  });

  it("renders a zero contract count as — rather than 0", () => {
    draw([row({ contractCount: 0 })]);
    expect(screen.getByTestId("cell-contract_count").textContent).toBe("—");
  });

  it("renders an unresolved oblast as — rather than blank", () => {
    draw([row({ oblastName: null })]);
    expect(screen.getByTestId("cell-oblast_name").textContent).toBe("—");
  });

  it("never prints a raw i18n key", () => {
    const { container } = draw([
      row({}),
      row({ isOfficialLinked: true, hasDeclaredStake: true }),
    ]);
    expect(container.textContent).not.toMatch(/\boc_[a-z_]+\b/);
    expect(container.textContent).not.toMatch(/\bcompanies_[a-z_]+\b/);
  });
});

describe("CompaniesBrowseDbScreen — the footer total", () => {
  it("reads the aggregate under the camelCase key the engine emits", () => {
    // buildAggSelect emits `sum${Camel}`, so a snake_case read is always undefined —
    // OfficialCompaniesScreen shipped exactly this regression once.
    AGG.current = { sumPublicMoneyEur: 12175105352, countAll: 100000 };
    AGG.total = 100000;
    draw([row({})]);
    const footer = screen.getByTestId("footer").textContent ?? "";
    expect(footer).not.toMatch(/^\s*0\b/);
    expect(footer).toMatch(/12/);
  });

  it("does not invent a total when the aggregate is absent", () => {
    AGG.current = {};
    AGG.total = 0;
    draw([row({})]);
    expect(screen.getByTestId("footer").textContent).toMatch(/0/);
  });
});
