// The ИВСС merge (Option 2, "two lanes, one section"): a magistrate's Сметна-палата
// filings (money, per-year net worth) and ИВСС filings (чл. 175а ЗСВ — citation only, no
// per-row net worth) now share ONE list inside PersonDeclarations, structurally separated
// into two labelled lanes rather than interleaved — so a blank amount never sits beside a
// filled one in the same run of rows. Retires the standalone PersonMagistrateHoldingsTile
// + PersonDeclarationTimeline rendering on this page (the tile itself stays, for the
// legacy /person/:name fallback screen).
//
// Hermetic: usePersonDeclarations/useDeclarationDetail's own fetch is stubbed exactly as
// in the sibling test files; usePersonMagistrateHoldings is mocked directly (it is a
// react-query hook hitting a different endpoint), so PersonDeclarations sees a fixed
// MagistrateHolding without a QueryClientProvider being asked to resolve a live fetch too.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import {
  clearDeclarationDetailCache,
  clearPersonDeclarationsCache,
  type DeclarationListItem,
} from "./usePersonDeclarations";
import type { MagistrateHolding } from "@/data/judiciary/useMagistrateHoldings";

// Unlike the sibling test files' count-only mock, this file's fixtures exercise several
// keys interpolated on OTHER params too (`pp_decl_cite_entry`'s `entry`), so this mock
// echoes the first interpolated value generically rather than just `count`.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && Object.keys(o).length ? `${k}:${Object.values(o)[0]}` : k,
    i18n: { language: "bg" },
  }),
}));

const holdingsMock = vi.fn();
vi.mock("@/data/judiciary/useMagistrateHoldings", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/data/judiciary/useMagistrateHoldings")
    >();
  return {
    ...actual,
    usePersonMagistrateHoldings: () => holdingsMock(),
  };
});

import { PersonDeclarations } from "./PersonDeclarations";

const ORIGIN = "http://62.176.124.194";

const renderPD = (el: ReactElement) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{el}</MemoryRouter>
    </QueryClientProvider>,
  );

const spFiling = (
  o: Partial<DeclarationListItem> & { id: number },
): DeclarationListItem =>
  ({
    tier: "magistrate",
    year: 2019,
    fiscalYear: null,
    type: "Annualy",
    institution: "Софийски районен съд",
    positionTitle: "Председател",
    filedAt: null,
    sourceUrl: "https://register.cacbg.bg/2019/x.xml",
    assetsEur: 7200,
    debtsEur: 36800,
    netEur: -29600,
    assetCount: 2,
    stakeCount: 0,
    eventCount: 0,
    excludedAssetRows: 0,
    cryptoCount: 0,
    cryptoEur: 0,
    usedAssetRows: 0,
    usedContractEur: 0,
    periodYear: 2019,
    ...o,
  }) as DeclarationListItem;

const stubSp = (rows: DeclarationListItem[]) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(
    (async (url: string) =>
      ({
        json: async () =>
          String(url).includes("declaration-detail") ? null : rows,
      }) as unknown as Response) as unknown as typeof fetch,
  );

const holding = (o: Partial<MagistrateHolding>): MagistrateHolding =>
  ({
    name: "Радост Емилова Дончева",
    position: "Съдия",
    court: "Софийски градски съд",
    companies: [],
    sourceUrl: `${ORIGIN}/declaracii/2026/parsed.xml`,
    filings: [
      {
        year: 2026,
        registerDir: "2026",
        ref: "8208/14.05.2026",
        sourceUrl: `${ORIGIN}/declaracii/2026/parsed.xml`,
        kind: "annual",
      },
      {
        year: 2025,
        registerDir: "2025",
        ref: "3870/24.04.2025",
        sourceUrl: `${ORIGIN}/declaracii/2025/other.xml`,
        kind: "annual",
      },
    ],
    filingsNameAmbiguous: false,
    ...o,
  }) as MagistrateHolding;

afterEach(() => {
  vi.unstubAllGlobals();
  holdingsMock.mockReset();
  clearDeclarationDetailCache();
  clearPersonDeclarationsCache();
});

describe("magistrate two-lane merge", () => {
  it("renders both lanes when the person has both СП and ИВСС filings", async () => {
    stubSp([spFiling({ id: 1 })]);
    holdingsMock.mockReturnValue({ holding: holding({}), year: 2026 });
    renderPD(
      <PersonDeclarations slug="x" magistrateName="Радост Емилова Дончева" />,
    );
    expect(await screen.findByText("pp_decl_lane_cac")).toBeInTheDocument();
    expect(screen.getByText("pp_decl_lane_ivss")).toBeInTheDocument();
    // The СП headline still renders — the ИВСС lane doesn't suppress it.
    expect(screen.getByText("officials_net_worth")).toBeInTheDocument();
    // Both ИВСС years are cited.
    expect(
      screen.getByText("pp_decl_cite_entry:8208/14.05.2026"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("pp_decl_cite_entry:3870/24.04.2025"),
    ).toBeInTheDocument();
  });

  it("shows only the ИВСС lane, and no headline stats, for an ИВСС-only magistrate", async () => {
    // No СП filings at all — the "magistrate-only" gap the merge exists to close.
    stubSp([]);
    holdingsMock.mockReturnValue({ holding: holding({}), year: 2026 });
    renderPD(
      <PersonDeclarations slug="x" magistrateName="Радост Емилова Дончева" />,
    );
    expect(await screen.findByText("pp_decl_lane_ivss")).toBeInTheDocument();
    expect(screen.queryByText("pp_decl_lane_cac")).not.toBeInTheDocument();
    expect(screen.queryByText("officials_net_worth")).not.toBeInTheDocument();
    expect(screen.getByText("pp_decl_ivss_only_note")).toBeInTheDocument();
  });

  it("self-hides when neither register has anything", async () => {
    stubSp([]);
    holdingsMock.mockReturnValue({ holding: null, year: null });
    const { container } = renderPD(
      <PersonDeclarations slug="x" magistrateName="Nobody Matches" />,
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/db/")),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders exactly the plain flat list for a non-magistrate (no lane labels)", async () => {
    // magistrateName is undefined — the overwhelming majority of declarants. The merge
    // must not add any visible chrome to this, the pre-existing path.
    stubSp([spFiling({ id: 1 })]);
    holdingsMock.mockReturnValue({ holding: null, year: null });
    renderPD(<PersonDeclarations slug="x" />);
    await screen.findByText("officials_net_worth");
    expect(screen.queryByText("pp_decl_lane_cac")).not.toBeInTheDocument();
    expect(screen.queryByText("pp_decl_lane_ivss")).not.toBeInTheDocument();
  });

  it("shows financials and companies only on the ONE filing the holding was parsed from", async () => {
    stubSp([spFiling({ id: 1 })]);
    holdingsMock.mockReturnValue({
      holding: holding({
        financials: {
          bankCashLv: 41100,
          securitiesLv: 0,
          realEstateCount: 1,
          realEstateCountParsed: 1,
        },
        companies: [
          {
            name: "ЮРИСТКОНСУЛТ ЕООД",
            stakePct: 50,
            eik: "175869042",
            eikAmbiguous: false,
          },
        ],
      }),
      year: 2026,
    });
    renderPD(
      <PersonDeclarations slug="x" magistrateName="Радост Емилова Дончева" />,
    );
    const user = userEvent.setup();
    await screen.findByText("pp_decl_lane_ivss");

    // Expand the PARSED filing (2026) — financials + company chip appear.
    const parsedToggle = await screen.findByText(
      "pp_decl_cite_entry:8208/14.05.2026",
    );
    await user.click(parsedToggle);
    expect(
      await screen.findByText("ЮРИСТКОНСУЛТ ЕООД · 50%"),
    ).toBeInTheDocument();
    expect(screen.getByText(/pp_decl_ivss_cash/)).toBeInTheDocument();

    // Collapse it again (each row's disclosure is independent — see FilingRow's own
    // pattern), THEN expand the OTHER filing (2025, not the parsed one) in isolation:
    // no financials, no companies.
    await user.click(parsedToggle);
    expect(
      screen.queryByText("ЮРИСТКОНСУЛТ ЕООД · 50%"),
    ).not.toBeInTheDocument();
    await user.click(
      await screen.findByText("pp_decl_cite_entry:3870/24.04.2025"),
    );
    expect(
      screen.queryByText("ЮРИСТКОНСУЛТ ЕООД · 50%"),
    ).not.toBeInTheDocument();
  });

  it("shows the name-ambiguity note only when the register flags it", async () => {
    stubSp([spFiling({ id: 1 })]);
    holdingsMock.mockReturnValue({
      holding: holding({ filingsNameAmbiguous: true }),
      year: 2026,
    });
    renderPD(
      <PersonDeclarations slug="x" magistrateName="Радост Емилова Дончева" />,
    );
    expect(
      await screen.findByText("pp_decl_ivss_ambiguous"),
    ).toBeInTheDocument();
  });

  it("drops an ИВСС filing whose sourceUrl is not the register's own origin", async () => {
    stubSp([spFiling({ id: 1 })]);
    holdingsMock.mockReturnValue({
      holding: holding({
        filings: [
          {
            year: 2026,
            registerDir: "2026",
            ref: "8208/14.05.2026",
            sourceUrl: "https://evil.example/looks-legit.xml",
            kind: "annual",
          },
        ],
      }),
      year: 2026,
    });
    renderPD(
      <PersonDeclarations slug="x" magistrateName="Радост Емилова Дончева" />,
    );
    await screen.findByText("officials_net_worth");
    // The one filing offered is off-origin, so the ИВСС lane never opens at all.
    expect(screen.queryByText("pp_decl_lane_ivss")).not.toBeInTheDocument();
  });

  it("shows the СП lane's assetless filings alongside the ИВСС lane (no headline stats)", async () => {
    // A magistrate whose only СП filing is an assetless incompatibility shell (the D2
    // case — assetCount: 0) AND who has ИВСС filings: `summary` stays null (no headline),
    // but `rows.length > 0` is still true, so the СП lane header and its assetless row
    // render alongside the ИВСС lane rather than the СП lane vanishing entirely.
    stubSp([
      spFiling({
        id: 1,
        type: "Other",
        assetCount: 0,
        assetsEur: 0,
        debtsEur: 0,
        netEur: 0,
      }),
    ]);
    holdingsMock.mockReturnValue({ holding: holding({}), year: 2026 });
    renderPD(
      <PersonDeclarations slug="x" magistrateName="Радост Емилова Дончева" />,
    );
    expect(await screen.findByText("pp_decl_lane_cac")).toBeInTheDocument();
    expect(screen.getByText("pp_decl_lane_ivss")).toBeInTheDocument();
    expect(screen.getByText("pp_decl_ivss_only_note")).toBeInTheDocument();
    expect(screen.queryByText("officials_net_worth")).not.toBeInTheDocument();
  });

  it("hides the СП-specific wealth caveat when there is no СП headline to caveat", async () => {
    // pp_wealth_caveat's text describes the СП net-worth computation; on the ИВСС-only
    // branch (no `summary`) nothing on the page computes a net worth, so the caveat must
    // not render there. Gated the same way as the StatCard grid (`latest && …`).
    stubSp([]);
    holdingsMock.mockReturnValue({ holding: holding({}), year: 2026 });
    renderPD(
      <PersonDeclarations slug="x" magistrateName="Радост Емилова Дончева" />,
    );
    await screen.findByText("pp_decl_lane_ivss");
    expect(screen.queryByText("pp_wealth_caveat")).not.toBeInTheDocument();
  });

  it("shows the СП wealth caveat when a headline is present, even alongside ИВСС", async () => {
    stubSp([spFiling({ id: 1 })]);
    holdingsMock.mockReturnValue({ holding: holding({}), year: 2026 });
    renderPD(
      <PersonDeclarations slug="x" magistrateName="Радост Емилова Дончева" />,
    );
    expect(await screen.findByText("pp_wealth_caveat")).toBeInTheDocument();
  });

  it("paginates past the top 5 ИВСС filings behind виж всички", async () => {
    stubSp([spFiling({ id: 1 })]);
    const many = Array.from({ length: 7 }, (_, i) => ({
      year: 2026 - i,
      registerDir: String(2026 - i),
      ref: `${1000 + i}/01.01.${2026 - i}`,
      sourceUrl: `${ORIGIN}/declaracii/${2026 - i}/f.xml`,
      kind: "annual",
    }));
    holdingsMock.mockReturnValue({
      holding: holding({ filings: many, sourceUrl: many[0].sourceUrl }),
      year: 2026,
    });
    renderPD(
      <PersonDeclarations slug="x" magistrateName="Радост Емилова Дончева" />,
    );
    await screen.findByText("pp_decl_lane_ivss");
    expect(
      screen.queryByText(`pp_decl_cite_entry:${many[6].ref}`),
    ).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(await screen.findByText("pp_decl_ivss_show_all:7"));
    expect(
      await screen.findByText(`pp_decl_cite_entry:${many[6].ref}`),
    ).toBeInTheDocument();
  });
});
