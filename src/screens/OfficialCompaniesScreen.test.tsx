// /governance/companies — what each row CLAIMS about a company.
//
// The retired /mp/companies had one decision worth testing (is the name a link) and this page
// has three, all of which are assertions about named companies and the people attached to them:
//
//   • a company reached only through WITHDRAWN registry filings must read as FORMER. 2,342 of
//     17,608 are in that state, and /person already renders the same pair that way — a page
//     that prints them unlabelled says a sitting official is currently a director.
//   • the two arms are different evidence and must be distinguishable, not merged.
//   • the money column is a broad basis, and €0 must read as "none", never as "unknown".
//
// `DbDataTable` is stubbed rather than exercised: it is separately tested, it fetches, and what
// this file is about is the column definitions the screen hands it. The stub renders every row
// through those definitions, so a broken `cell` still fails here.

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { bgCorpus as bg } from "@/locales/allKeys";
import type { OfficialCompanyRow } from "./OfficialCompaniesScreen";

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
// each row's cells. Anything the screen gets wrong in a `cell` shows up in the DOM.
// ⚠️ THE STUB MUST RENDER renderAggregates TOO. Its first version rendered only the column
// cells, and that omission is precisely why the footer shipped reading a key the engine never
// emits: it reported €0 against a true €12.18bn and no test could see it. A stub that
// exercises fewer props than the component uses is a test that certifies the untested half.
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

const { OfficialCompaniesScreen } = await import("./OfficialCompaniesScreen");

const row = (over: Partial<OfficialCompanyRow>): OfficialCompanyRow => ({
  uic: "204361427",
  name: "ПРИМЕР ООД",
  legalForm: "OOD",
  seat: "БЪЛГАРИЯ, гр. София",
  status: "active",
  entityClass: "company",
  oblastName: "София (столица)",
  personCount: 1,
  hasRegistryLink: true,
  hasDeclaredStake: false,
  hasCurrentRole: true,
  moneyEur: 0,
  ...over,
});

const draw = (data: OfficialCompanyRow[]) => {
  rows.current = data;
  return render(
    <MemoryRouter>
      <OfficialCompaniesScreen />
    </MemoryRouter>,
  );
};

const evidence = () => screen.getByTestId("cell-evidence");

describe("OfficialCompaniesScreen — the evidence a row claims", () => {
  it("reads the rows from the server-side resource, not a client blob", () => {
    draw([row({})]);
    expect(screen.getByTestId("table")).toHaveAttribute(
      "data-resource",
      "official_companies",
    );
  });

  it("labels a registry link and a declared stake separately", () => {
    draw([row({ hasRegistryLink: true, hasDeclaredStake: true })]);
    const cell = evidence();
    expect(
      within(cell).getByText(dict.oc_evidence_registry),
    ).toBeInTheDocument();
    expect(
      within(cell).getByText(dict.oc_evidence_declared),
    ).toBeInTheDocument();
  });

  it("marks a company whose every registry filing was withdrawn as FORMER", () => {
    // The one that matters. Without it, 2,342 companies read as current attachments.
    draw([row({ hasRegistryLink: true, hasCurrentRole: false })]);
    expect(
      within(evidence()).getByText(dict.oc_evidence_former),
    ).toBeInTheDocument();
  });

  it("does NOT mark a current registry role as former", () => {
    draw([row({ hasRegistryLink: true, hasCurrentRole: true })]);
    expect(
      within(evidence()).queryByText(dict.oc_evidence_former),
    ).not.toBeInTheDocument();
  });

  it("never marks a stake-only company former — a filing cannot be withdrawn", () => {
    // has_current_role is false for a stake-only row by construction (a declaration carries
    // no erasure date), so gating the chip on hasRegistryLink is what stops it printing
    // „бивше" against a company nobody ever held a registry role in.
    draw([
      row({
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

describe("OfficialCompaniesScreen — what kind of organisation each row is", () => {
  it("names a non-company kind rather than calling it a фирма", () => {
    // 5,200 of 17,608 rows are not companies. „Сдружение Български Червен кръст" (€15.7m)
    // rendered as an office-holder's фирма is a different and wrong claim.
    draw([row({ entityClass: "ngo_assoc", name: "БЪЛГАРСКИ ЧЕРВЕН КРЪСТ" })]);
    expect(
      within(screen.getByTestId("cell-name")).getByText(dict.oc_kind_ngo_assoc),
    ).toBeInTheDocument();
  });

  it("does not label an ordinary company with a kind", () => {
    // The label exists to mark the exception; printing „фирма" on 12,408 rows is noise.
    draw([row({ entityClass: "company" })]);
    expect(
      within(screen.getByTestId("cell-name")).queryByText(dict.oc_kind_company),
    ).not.toBeInTheDocument();
  });
});

describe("OfficialCompaniesScreen — the row's other columns", () => {
  it("links the company by EIK and prints the identifier beside it", () => {
    draw([row({ uic: "204361427", name: "ПРИМЕР ООД" })]);
    const cell = screen.getByTestId("cell-name");
    expect(within(cell).getByRole("link")).toHaveAttribute(
      "href",
      "/company/204361427",
    );
    expect(within(cell).getByText("204361427")).toBeInTheDocument();
  });

  it("renders €0 as none, not as an amount", () => {
    // The money column is a broad basis over four corpora; 14,577 of 17,608 rows are at zero.
    // Printing „€0,00" reads as a measurement where „—" reads as the absence it is.
    draw([row({ moneyEur: 0 })]);
    expect(screen.getByTestId("cell-money_eur").textContent).toBe("—");
  });

  it("renders an unresolved seat as — rather than blank", () => {
    // 40% of the population has no resolved oblast. A blank cell reads as a rendering bug.
    draw([row({ oblastName: null })]);
    expect(screen.getByTestId("cell-oblast_name").textContent).toBe("—");
  });

  it("never prints a raw i18n key", () => {
    const { container } = draw([row({}), row({ hasDeclaredStake: true })]);
    expect(container.textContent).not.toMatch(/\boc_[a-z_]+\b/);
  });
});

describe("OfficialCompaniesScreen — the footer total", () => {
  it("reads the aggregate under the camelCase key the engine emits", () => {
    // buildAggSelect emits `sum${Camel}`, so `sum_money_eur` is always undefined. Read
    // wrongly the footer said €0 against €12.18bn, on every page, for every filter.
    AGG.current = { sumMoneyEur: 12175105352, countAll: 17608 };
    AGG.total = 17608;
    draw([row({})]);
    const footer = screen.getByTestId("footer").textContent ?? "";
    expect(footer).not.toMatch(/^\s*0\b/);
    expect(footer).toMatch(/12/);
    expect(footer).toContain("17 608".replace(/ /g, "\u00a0"));
  });

  it("does not invent a total when the aggregate is absent", () => {
    AGG.current = {};
    AGG.total = 0;
    draw([row({})]);
    expect(screen.getByTestId("footer").textContent).toMatch(/0/);
  });
});

describe("OfficialCompaniesScreen — the copy", () => {
  it("does not call the population MPs", () => {
    // The page covers every public office-holder; MPs are a minority of 17,608 companies.
    // The retired page's title said „народни представители" and would have been wrong here.
    for (const k of ["oc_title", "oc_intro", "oc_col_people", "oc_footnote"])
      expect(dict[k]).not.toMatch(/народни представители/);
  });

  it("states what the money column combines and what an absent oblast means", () => {
    expect(dict.oc_footnote).toMatch(/обществени поръчки/);
    expect(dict.oc_footnote).toMatch(/40%/);
  });
});
