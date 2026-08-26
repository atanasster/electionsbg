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
//
// ⚠️ THE TABLE ONLY EXISTS WHEN THE READER HAS ASKED FOR IT, since the search-first rework.
// Every `draw()` below therefore mounts at `?browse=1` — the explicit „show me anyway" — or the
// screen renders its LANDING and there are no cells to assert on at all. The tests that pin the
// landing/table SWITCH itself live further down.

import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { bgCorpus as bg } from "@/locales/allKeys";
import type { CompanyBrowseRow } from "./CompaniesBrowseDbScreen";
import { NARROWING_PARAMS } from "@/data/companies/useUrlCompanyFilters";

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
    onData,
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
    // ⚠️ THE STUB MUST HONOUR `onData`, and this is the second time this file has learned the
    // lesson its own header records: „a stub exercising fewer props than the component uses
    // certified the untested half". Without it the screen's `agg` stays empty, the head band
    // returns `[]` — correctly, since a declared basis must never sit under a loading state —
    // and every assertion about a KPI figure fails for a reason that has nothing to do with
    // the figure.
    onData?: (
      resp: { aggregates?: Record<string, unknown>; total: number },
      request: Record<string, unknown>,
    ) => void;
  }) => {
    // ⚠️ ASYNCHRONOUSLY, because the real one is. The screen resets its aggregates whenever the
    // filter set changes (so a filter click cannot paint the previous count under the new
    // basis), and a child effect runs BEFORE its parent's — so a synchronous callback here is
    // immediately cleared by that reset and the band stays in skeletons for a reason no
    // assertion would explain. A microtask puts it after mount, where a fetch would be.
    React.useEffect(() => {
      queueMicrotask(() =>
        onData?.(
          { aggregates: AGG.current, total: AGG.total },
          { filters: { global: undefined } },
        ),
      );
    }, [onData]);
    return (
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
    );
  },
}));

// The facets feed the pickers, the KPI band and the landing cards. Stubbed to empty: this file
// is about the row cells, and an unstubbed hook needs a QueryClient it has no reason to hold.
// `useCompanyFacets`' own contract is covered by `useRegistryFacets.test.tsx`.
const FACETS = vi.hoisted(() => ({
  current: {} as Record<
    string,
    Record<string, { value: unknown; count: number }[]>
  >,
}));
vi.mock("@/data/companies/useCompanyFacets", () => ({
  useCompanyFacets: () => ({ merged: {}, bySpec: FACETS.current }),
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

/** What the LIVE route returns, shape-for-shape. ⚠️ `is_official_linked` carries a real
 *  BOOLEAN, because node-postgres serialises a PG `bool` as one — that is not a detail of this
 *  fixture, it is the thing the band reads, and a `=== "true"` against it publishes 0. */
const LIVE_FACETS = {
  corpus: {
    entity_class: [
      { value: "company", count: 988_644 },
      { value: "chitalishte", count: 3_439 },
    ],
    is_official_linked: [
      { value: false, count: 1_004_917 },
      { value: true, count: 17_675 },
    ],
    has_signal: [
      { value: false, count: 923_855 },
      { value: true, count: 98_737 },
    ],
  },
  kpis: {
    entity_class: [
      { value: "company", count: 988_644 },
      { value: "chitalishte", count: 3_439 },
    ],
    is_official_linked: [
      { value: false, count: 1_004_917 },
      { value: true, count: 17_675 },
    ],
  },
  contracts: { entity_class: [{ value: "company", count: 18_689 }] },
  money: { entity_class: [{ value: "company", count: 59_884 }] },
  corpusContracts: { entity_class: [{ value: "company", count: 18_689 }] },
};

const draw = (
  data: CompanyBrowseRow[],
  search = "?browse=1",
  facets: Record<string, unknown> = {},
) => {
  rows.current = data;
  FACETS.current = facets as typeof FACETS.current;
  return render(
    <MemoryRouter initialEntries={[`/companies${search}`]}>
      <CompaniesBrowseDbScreen />
    </MemoryRouter>,
  );
};

const evidence = () => screen.getByTestId("cell-evidence");

/** A rendered integer, matched tolerantly on its grouping separator.
 *
 *  ⚠️ `toLocaleString("bg-BG")` groups with a NON-BREAKING space (U+00A0), so „17 675" typed
 *  from a keyboard matches nothing — and the failure reads as „the figure is missing", which is
 *  exactly the bug these tests exist to catch, so it is the worst possible false positive. The
 *  exact codepoint is an ICU implementation detail; match the class, never the literal. */
const num = (n: number) =>
  new RegExp(
    `^${n.toLocaleString("bg-BG").replace(/[\s\u00a0\u202f]/g, "[\\s\\u00a0\\u202f]")}$`,
  );

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

// ── THE LANDING / TABLE SWITCH ────────────────────────────────────────────────────────────
//
// The rule is `queryIsSendable || hasNarrowingFilters || browseAll`, and every clause is
// load-bearing. A dimension wrongly OUT renders a BLANK page to a reader who arrived from a
// cross-link — and every cross-link into this page is a filter rather than a query. A dimension
// wrongly IN opens a 1,022,592-row table nobody asked for.

const table = () => screen.queryByTestId("table");

describe("CompaniesBrowseDbScreen — whether there is a table at all", () => {
  it("a bare /companies renders the LANDING, not a table", () => {
    // The defect this whole rework removes: the default table's first page was €2.43bn СОФАРМА
    // ТРЕЙДИНГ and five more of the same, unchanged on every arrival, forever.
    draw([row({})], "");
    expect(table()).toBeNull();
  });

  it("a ≥3-character ?q renders one", () => {
    draw([row({})], "?q=софарма");
    expect(table()).not.toBeNull();
  });

  it("⚠️ a 1–2 character ?q does NOT — the engine would answer it with a 400", () => {
    // `companies` has no unfloored arm to fall back on: `uic` is `searchEq` with
    // `searchWhen: "[0-9]{8,14}"`, so a short term routes that arm OUT and only `name`
    // (floor 3) survives, which then refuses. Opening a table on it renders the destructive
    // „Данните не можаха да се заредят." panel.
    draw([row({})], "?q=со");
    expect(table()).toBeNull();
  });

  it("⚠️ ?political=1 renders one — and the OG capture depends on it", () => {
    // scripts/og/capture-screens.ts shoots `companies?political=1&elections=2026_04_19` and
    // waits on `[data-og="official-companies-og"] tbody tr.group`. Treated as a scope rather
    // than a narrowing, the landing would render, the wait would time out, and the job would
    // silently keep serving the old share card — the failure its own comment warns about.
    draw([row({})], "?political=1&elections=2026_04_19");
    expect(table()).not.toBeNull();
  });

  it("each of the other six narrowings renders one on its own", () => {
    for (const search of [
      "?class=chitalishte",
      "?status=bankrupt",
      `?oblast=${encodeURIComponent("Варна")}`,
      "?obshtina=SOF46",
      "?money=1",
      "?contracts=1",
    ]) {
      cleanup();
      draw([row({})], search);
      expect(table(), search).not.toBeNull();
    }
  });

  it("⚠️ ?scope=signal alone does NOT — it is a POPULATION, not a question", () => {
    // If flipping the scope opened a table, the landing's own scope choice would dismiss the
    // landing. Same rule as `?sector` on /persons.
    draw([row({})], "?scope=signal");
    expect(table()).toBeNull();
  });

  it("?browse=1 renders one", () => {
    draw([row({})], "?browse=1");
    expect(table()).not.toBeNull();
  });

  it("the data-og anchor is present in BOTH bodies", () => {
    // The capture's anchor is on the outer div, so it survives the switch — but the wait is on
    // a table row, which is why ?political must open one.
    const { container } = draw([row({})], "");
    expect(
      container.querySelector('[data-og="official-companies-og"]'),
    ).not.toBeNull();
    cleanup();
    const withTable = draw([row({})], "?browse=1");
    expect(
      withTable.container.querySelector('[data-og="official-companies-og"]'),
    ).not.toBeNull();
  });
});

// ── THE CHIPS ─────────────────────────────────────────────────────────────────────────────

describe("CompaniesBrowseDbScreen — the active-filter chips", () => {
  it("⚠️ every NARROWING_PARAM produces a removable chip", () => {
    // A narrowing with no chip is a table filtered by something the page names nowhere — and
    // for `?obshtina`, which has no picker and no producer, the chip is the ONLY surface the
    // dimension has. Iterated from the contract rather than hand-written, so a param added
    // there without a chip fails here.
    const SEARCH: Record<(typeof NARROWING_PARAMS)[number], string> = {
      political: "?political=1",
      class: "?class=chitalishte",
      status: "?status=bankrupt",
      oblast: `?oblast=${encodeURIComponent("Варна")}`,
      obshtina: "?obshtina=SOF46",
      money: "?money=1",
      contracts: "?contracts=1",
    };
    for (const p of NARROWING_PARAMS) {
      cleanup();
      draw([row({})], SEARCH[p]);
      const group = screen.getByRole("group");
      expect(
        within(group).getAllByRole("button").length,
        `?${p} produced no chip`,
      ).toBeGreaterThan(0);
    }
  });

  it("⚠️ the obshtina chip prints the RAW CODE, not a resolved name", () => {
    // This corpus spells Столична община `SOF46` — a FOURTH synonym beside the three
    // obshtinaPlace.ts knows — and `canonicalObshtina('SOF00')` returns `SFO_CITY`, which
    // matches ZERO rows here. A chip resolving „Столична община" over an empty table would be a
    // confident Bulgarian sentence saying the capital contains no companies.
    draw([row({})], "?obshtina=SOF46");
    expect(
      within(screen.getByRole("group")).getByText("SOF46"),
    ).toBeInTheDocument();
  });

  it("renders no chip group when nothing is narrowed", () => {
    draw([row({})], "?browse=1");
    expect(screen.queryByRole("group")).toBeNull();
  });
});

// ── THE FIGURES THE BAND AND THE LANDING PUBLISH ──────────────────────────────────────────
//
// ⚠️ THESE EXIST BECAUSE A `=== "true"` PASSED EVERY OTHER TEST IN THE REPO. The facets were
// mocked to `{}` everywhere, so the band never rendered a figure and the one comparison that
// decides whether „Свързани с публично лице" reads 17 675 or 0 was covered by nothing.

describe("CompaniesBrowseDbScreen — the figures", () => {
  it('⚠️ reads a BOOLEAN facet bucket, not the string "true"', async () => {
    // node-postgres serialises a PG `bool` as a real boolean (and `numeric` as a string, so the
    // two disagree). Comparing against "true" matches nothing, and the `?? 0` then publishes
    // „0" — silently, on the headline figure this page exists for. Reverting the comparison
    // must fail HERE.
    draw([row({})], "?browse=1", LIVE_FACETS);
    expect(await screen.findByText(num(17_675))).toBeInTheDocument();
  });

  it("counts contractors from a facet under a FILTER, not from a contract_count facet", async () => {
    // `contract_count` holds 411 distinct values and runDbFacets orders by count and clamps at
    // 500, so summing „buckets >= 1" truncates. And an unknown column is not an error — the
    // route silently OMITS it — so the first cut asked for `contract_count_any`, got a 200 with
    // the figure missing, and published 0.
    draw([row({})], "?browse=1", LIVE_FACETS);
    expect(await screen.findByText(num(18_689))).toBeInTheDocument();
  });

  it("every landing card carries a real count", () => {
    // The first cut fell through a `c.key === …` chain to `: undefined` for two of the four,
    // rendering „—" for ever on a landing whose whole job is four counted ways in.
    draw([row({})], "", LIVE_FACETS);
    // `getAllByText`: on the landing the band and the cards legitimately publish the same
    // figures, so each appears twice.
    for (const n of [17_675, 59_884, 18_689, 3_439])
      expect(screen.getAllByText(num(n)).length, String(n)).toBeGreaterThan(0);
  });

  it("⚠️ the evidence rail's LINK carries the scope its COUNT was computed under", () => {
    // Under ?scope=signal the rail's counts are floored while `usePreserveParams`' allowlist
    // (elections · recount · view · party_tabs · summary · area · pscope — no `scope`) strips it
    // from a bare `/companies?class=X`. „фирма 67 456" would then open 988 644 rows.
    draw([row({})], "?scope=signal&browse=1", LIVE_FACETS);
    const link = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href")?.includes("class=company"));
    expect(link?.getAttribute("href")).toMatch(/scope=signal/);
  });

  it("the landing CARDS drop the scope — their counts were computed without the floor", () => {
    // The opposite rule, deliberately: all four card populations imply has_signal (0
    // counterexamples), so their counts are the same either side of the floor, and answering
    // them inside the floored scope would show fewer rows than the card promised.
    draw([row({})], "?scope=signal", LIVE_FACETS);
    const card = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href")?.includes("political=1"));
    expect(card?.getAttribute("href")).not.toMatch(/scope=/);
  });

  it("⚠️ withholds the linked cell under ?political=1", async () => {
    // The facet excludes its own dimension, so it would hold at 17 675 over a set that IS
    // 17 675 — the reader's own filter read back to them as a finding.
    draw([row({})], "?political=1", LIVE_FACETS);
    // Wait for the band to LOAD before asserting an absence — otherwise this passes while the
    // band is still skeletons, which is the vacuous form of exactly this assertion.
    expect(await screen.findByText(num(18_689))).toBeInTheDocument();
    expect(screen.queryByText(num(17_675))).toBeNull();
  });
});
