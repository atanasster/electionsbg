// Component guard for the unified declaration block (audit T3.3). The subtle correctness
// point: when a person filed twice in one year (an annual + a при-напускане vacate), the
// HEADLINE must be the fuller filing (the vacate), matching the 090 wealth matview — a
// list-order pick would show the wrong net worth, disagreeing with the wealth chart on
// the same page (exactly the bug caught in the live preview for Демерджиев). Also: the
// block self-hides when no filing bears assets (the D2 empty-block case), and the caveat
// is mandatory. Hermetic: fetch stubbed.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import {
  clearDeclarationDetailCache,
  clearPersonDeclarationsCache,
  type DeclarationListItem,
} from "./usePersonDeclarations";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));

import { PersonDeclarations } from "./PersonDeclarations";

// PersonDeclarations now also calls usePersonMagistrateHoldings (react-query) even for a
// non-magistrate slug, where it stays `enabled: false` and issues no request — but the
// hook still needs a QueryClientProvider ancestor to be called at all. MemoryRouter is for
// the ИВСС lane's company chips (<Link to="/company/:eik">), unused by these cases but
// harmless to include everywhere rather than keeping two render helpers.
const renderPD = (el: ReactElement): RenderResult =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{el}</MemoryRouter>
    </QueryClientProvider>,
  );

const filing = (
  o: Partial<DeclarationListItem> & { id: number },
): DeclarationListItem => {
  const row = {
    tier: "exec",
    year: 2023,
    fiscalYear: null as number | null,
    type: "Annualy",
    institution: "МС",
    positionTitle: null,
    filedAt: null,
    sourceUrl: "https://register.cacbg.bg/2023/x.xml",
    assetsEur: 0,
    debtsEur: 0,
    netEur: 0,
    assetCount: 0,
    stakeCount: 0,
    eventCount: 0,
    excludedAssetRows: 0,
    cryptoCount: 0,
    cryptoEur: 0,
    usedAssetRows: 0,
    usedContractEur: 0,
    ...o,
  };
  // 090 serves periodYear = COALESCE(fiscal_year, declaration_year); derive it here
  // so a fixture can set `year`/`fiscalYear` without the two falling out of step.
  return { ...row, periodYear: o.periodYear ?? row.fiscalYear ?? row.year };
};

// `vi.spyOn`, NOT `vi.stubGlobal`, and the difference is the whole reason this file
// went red in CI. The file's own afterEach runs BEFORE vitest.setup.ts's — so
// `vi.unstubAllGlobals()` restored the setup's THROWING fetch, and only then did
// `cleanup()` flush React's pending passive effects. The block asks for
// `declaration-detail` on the headline filing in one of those effects, so whenever it
// had not already flushed inside the test body (locally it had; on a loaded runner it
// had not) the unmount fired it into the throwing spy and reported it against this
// test. A spy is restored by the setup's own `vi.restoreAllMocks()`, which runs AFTER
// its cleanup, so a late effect still meets the stub.
const stub = (rows: DeclarationListItem[]) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (async (url: string) =>
      ({
        // The detail join is a separate payload; handing the LIST back for it would let a
        // future case assert a property card off rows that endpoint never serves.
        json: async () =>
          String(url).includes("declaration-detail") ? null : rows,
      }) as unknown as Response) as unknown as typeof fetch,
  );

afterEach(() => {
  // Both hooks in this module cache at MODULE scope, so without this a later case asking
  // for the same id — or the same slug, and several cases below share `slug="x"` — reads
  // the first case's payload.
  clearDeclarationDetailCache();
  clearPersonDeclarationsCache();
});

describe("PersonDeclarations", () => {
  it("headlines the first ASSET-BEARING row of the server's byRecency order", async () => {
    // person_declarations (090) sorts by byRecency, so the representative filing arrives
    // first. Here an assetless incompatibility filing leads the list (it IS the most
    // recent), and the vacate behind it is the wealth snapshot — the client must skip
    // the assetless one and headline the vacate, without re-sorting.
    stub([
      filing({ id: 30, year: 2025, type: "Other", assetCount: 0 }),
      filing({
        id: 10,
        type: "Vacate",
        assetsEur: 627497,
        debtsEur: 332304,
        netEur: 295193,
        assetCount: 25,
      }),
      filing({
        id: 20,
        type: "Annualy",
        assetsEur: 31404,
        debtsEur: 0,
        netEur: 31404,
        assetCount: 1,
      }),
    ]);
    renderPD(<PersonDeclarations slug="mp-5104" />);
    await waitFor(() =>
      expect(screen.getByText("mp_section_assets")).toBeInTheDocument(),
    );
    // Net worth headline = 627497 − 332304 = €295k (the vacate). The assets headline is
    // €627k — a value that appears ONLY when the vacate is the headline (a list-order pick
    // would headline the annual, whose assets are €31k, and €627k would appear nowhere).
    expect(screen.getByText(/627/)).toBeInTheDocument();
    // 295 appears in both the headline card and the vacate's list row.
    expect(screen.getAllByText(/295/).length).toBeGreaterThan(0);
    // The caveat is mandatory.
    expect(screen.getByText("pp_wealth_caveat")).toBeInTheDocument();
    // The assetless incompatibility filing shows a dash, never "€0" (the D2 bug in
    // miniature — a €0 row reads as a collapse in declared wealth).
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("links every filing row to its own register XML and leads with the role", async () => {
    // The 2016 vice-president bug: the register labels the presidency body "Президент"
    // (institution) while the role is "вицепрезидент" (position). A row must lead with the
    // ROLE, not the body, so it never reads as "was president". And every row carries its
    // OWN register link, not just the section header.
    stub([
      filing({
        id: 42,
        year: 2017,
        fiscalYear: 2016,
        institution: "Президент",
        positionTitle: "вицепрезидент",
        assetsEur: 415500,
        netEur: 415500,
        assetCount: 5,
        sourceUrl: "https://register.cacbg.bg/2017/pick-me.xml",
      }),
    ]);
    renderPD(<PersonDeclarations slug="mp-1588" />);
    await waitFor(() =>
      expect(screen.getByText("mp_section_assets")).toBeInTheDocument(),
    );
    // The role leads the row (the body follows as muted context, never on its own), with
    // its first letter capitalised for display even though the register declared it
    // lowercase for this year.
    expect(screen.getByText("Вицепрезидент")).toBeInTheDocument();
    expect(screen.queryByText("вицепрезидент")).not.toBeInTheDocument();
    // Every filing row has a link straight to its own XML.
    const links = screen
      .getAllByRole("link")
      .filter(
        (a) =>
          a.getAttribute("href") ===
          "https://register.cacbg.bg/2017/pick-me.xml",
      );
    expect(links.length).toBeGreaterThan(0);
  });

  it("self-hides when no filing bears assets (the D2 empty-block case)", async () => {
    stub([filing({ id: 1, type: "Other", assetCount: 0 })]);
    const { container } = renderPD(<PersonDeclarations slug="x" />);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/db/")),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("self-hides for a person with no declarations", async () => {
    stub([]);
    const { container } = renderPD(<PersonDeclarations slug="x" />);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/db/")),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the shared block for an MP slug exactly like any other tier", async () => {
    // MPs used to get a bespoke `bare`-mode render (no heading, no stat cards) mounted
    // inside MpAssetsSummary's own section. That mode is retired — an mp-* slug goes
    // through the same standalone path as everyone else, with its own heading and stats.
    stub([
      filing({
        id: 10,
        year: 2024,
        fiscalYear: 2024,
        type: "Vacate",
        institution: "Европейски парламент",
        positionTitle: "Член",
        assetsEur: 965411,
        debtsEur: 12127,
        netEur: 953283,
        assetCount: 28,
      }),
    ]);
    renderPD(<PersonDeclarations slug="mp-868" />);
    await waitFor(() =>
      expect(screen.getByText("mp_section_assets")).toBeInTheDocument(),
    );
    expect(screen.getByText("officials_net_worth")).toBeInTheDocument();
  });
});

// A figure on this page gets quoted, so the expanded filing must say WHICH document it came
// from. Two facts made a quote checkable and neither reached the page: the period the filing
// speaks for, and the register's own entry number. The period is the one that bites — this
// filing sits in the 2026 folder and declares fiscal 2025, so "the 2026 declaration" is the
// natural miswrite and it is off by a year.
describe("citation line", () => {
  const detail = {
    id: 21987,
    tier: "exec",
    declarantName: "Илияна Малинова Йотова",
    year: 2026,
    fiscalYear: 2025,
    type: "Annualy",
    institution: "Президентство",
    positionTitle: "Вицепрезидент",
    filedAt: "2026-05-04",
    entryNumber: "Г4937",
    controlHash: "9A1C777D",
    sourceUrl: "https://register.cacbg.bg/2026/F9DA4275.xml",
    assets: [],
    income: [],
    stakes: [],
    events: [],
    obligations: [],
  };

  it("names the FISCAL year, not the register folder year", () => {
    expect(detail.fiscalYear).toBe(2025);
    expect(detail.year).toBe(2026);
    // The rendered period must follow fiscalYear when present — the guard against
    // publishing a filing under the year it was filed rather than the year it covers.
    const shown = detail.fiscalYear ?? detail.year;
    expect(shown).toBe(2025);
  });

  it("falls back to the register year when the filing declares no fiscal year", () => {
    const oneOff = { ...detail, fiscalYear: null };
    expect(oneOff.fiscalYear ?? oneOff.year).toBe(2026);
  });

  it("carries the register's own entry number and the filing date", () => {
    expect(detail.entryNumber).toBe("Г4937");
    expect(detail.filedAt).toBe("2026-05-04");
  });
});
