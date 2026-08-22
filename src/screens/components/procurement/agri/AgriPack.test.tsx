// The claims only a RENDER can check — the ones the step-2 review caught, all
// three of which were correct numbers under labels that made them false.
//
// A source scan (sectorDashboards.test.ts) proves the scope wiring exists; it
// cannot read a caption. And every figure here is right in the payload and was
// wrong on the page:
//
//   * the no-ЕИК bucket was labelled „Физически лица", which migration 162's
//     header and /subsidies/untraceable both state outright is false — Напоителни
//     системи ЕАД (€47.8m) and Община Баните are in that bucket;
//   * `noEikBeneficiaries` was rendered as a count of people, when it counts
//     distinct name+province PAIRS („Не е брой хора", per the sibling page);
//   * `noEikCompanyShapedEurFloor` — a FLOOR over unmistakable legal-form markers
//     — sat under the label „Непроследими", whose true figure is the whole no-ЕИК
//     bucket, 4× larger on the default scope and 200,000× on 2015.
//
// Plus the two-bases rule the whole pack exists to keep: a payout figure and a
// procurement figure on one page must never read as addable.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { bgCorpus as bgDict } from "@/locales/allKeys";
import type { AgriHubStats } from "@/data/agri/useAgriHubStats";

// The house i18n mock: the real corpus, pinned to bg, so the assertions read the
// Bulgarian a Bulgarian reader sees.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: "bg" };
    },
    t: (k: string) => (bgDict as Record<string, string>)[k] ?? k,
  }),
}));

// Measured off the live cache for scope '' (2025) — see the plan's §1.1.
const STATS: AgriHubStats = {
  scopeKey: "",
  scopeYear: 2025,
  paymentRows: 230214,
  totalEur: 1586940416.44,
  entityCountExPayer: 8396,
  entityEurExPayer: 804166977.11,
  noEikEur: 782773439.33,
  noEikBeneficiaries: 24727,
  noEikRows: 171916,
  noEikCompanyShapedEurFloor: 196423242.74,
  noEikPctOfTotalEur: 49.3,
  schemeCount: 281,
  topScheme: "I.А.1-1 oсновно подпомагане на доходите за устойчивост",
  topSchemeEur: 382668993.14,
  oblastCount: 28,
  topOblast: "София (столица)",
  topOblastEur: 127930399.74,
  top100PctOfEntityEur: 14.82,
  top1000PctOfEntityEur: 56.29,
  politicalEiks: 239,
  politicalEur: 21483323.47,
  politicalPeople: 260,
  politicalBasisBuilt: true,
  isunEiks: 2278,
  contractEiks: 373,
  crossStream: {
    muniTransferEur: null,
    muniTransferYear: null,
    muniCount: null,
  },
};

const hub = { data: STATS as AgriHubStats | null | undefined };

vi.mock("@/data/agri/useAgriHubStats", () => ({
  useAgriHubStats: () => hub,
}));

// The gate is exercised for real in sectorDashboards.test.ts (position + the four
// wiring rules). Here it only has to let the children through.
vi.mock("@/screens/subsidies/AgriScopeGate", () => ({
  AgriScopePicker: () => <div data-testid="agri-scope-picker" />,
  AgriScopeFallback: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/data/agri/useAgriScope", async (orig) => ({
  ...(await orig<typeof import("@/data/agri/useAgriScope")>()),
  useAgriScope: () => ({
    scope: "ns",
    setScope: () => {},
    data: {},
    state: "ready" as const,
    paused: false,
    refetch: () => {},
  }),
}));

// The three-basis strip has its OWN test (AgriBudgetBasesTile.test.tsx) and pulls a
// React Query hook this file has no provider for. Stubbed to a marker so the two
// assertions that matter here still hold: it renders, and it is fed the SAME payout
// figure the hero above it shows — a second fetch would let the two disagree.
const budgetTileProps = vi.fn();
vi.mock("./AgriBudgetBasesTile", () => ({
  AgriBudgetBasesTile: (p: Record<string, unknown>) => {
    budgetTileProps(p);
    return <div data-testid="agri-budget-bases" />;
  },
}));

vi.mock("@/data/procurement/useAwarderGroupModel", () => ({
  useAwarderGroupModel: () => ({
    model: {
      totalEur: 596988935,
      contractCount: 3885,
      supplierCount: 861,
      suppliers: [],
      years: [],
      categories: [],
    },
    byUnit: Array.from({ length: 66 }, (_, i) => ({
      eik: String(i),
      totalEur: 1,
      contractCount: 1,
      bidKnownN: 0,
      singleBidN: 0,
    })),
    groupTotalEur: 596988935,
    isLoading: false,
    isError: false,
  }),
}));

const { AgriPack } = await import("./AgriPack");

const at = () =>
  render(
    <MemoryRouter>
      <AgriPack eik="121100421" scopeWindow={{ from: null, to: null }} />
    </MemoryRouter>,
  );

describe("AgriPack — the labels the numbers live under", () => {
  it("never calls the no-ЕИК bucket „физически лица“", () => {
    at();
    // The one phrase this band may not contain as a LABEL for the bucket. It may
    // appear inside the explanatory sentence that denies it, so the check is on
    // the legend text, which is where the money sits.
    expect(screen.queryByText(/^Физически лица/)).not.toBeInTheDocument();
    expect(screen.getByText(/Без ЕИК —/)).toBeInTheDocument();
  });

  it("says in words that „без ЕИК“ is not „физическо лице“", () => {
    at();
    // Not merely avoiding the wrong label — stating the rule, because a reader
    // who does not know it will supply it themselves.
    expect(screen.getByText(/НЕ значи .физическо лице/)).toBeInTheDocument();
  });

  it("calls the name count „различни имена“ and denies it is a headcount", () => {
    at();
    expect(screen.getByText(/24 727 различни имена/)).toBeInTheDocument();
    expect(screen.getByText(/не брой хора/)).toBeInTheDocument();
  });

  it("labels the company-shaped figure as a FLOOR over the no-ЕИК money", () => {
    at();
    // The label must scope it to the no-ЕИК bucket ("от тях"), not to everything…
    expect(
      screen.getByText(/^От тях безспорни фирми и общини \(поне\)$/),
    ).toBeInTheDocument();
    // …and must say it is a floor rather than a census, in words.
    expect(
      screen.getByText(/ДОЛНА граница, не преброяване/),
    ).toBeInTheDocument();
  });

  it("declares the oblast basis as the recipient's registered seat", () => {
    at();
    // „София (столица) е водещата земеделска област" is a false claim built from
    // a correct number. The caveat is what makes the tile honest.
    expect(
      screen.getByText(
        /седалището по регистрация, а не мястото, където се обработва земята/,
      ),
    ).toBeInTheDocument();
  });

  it("keeps the payout and procurement bases apart, in words", () => {
    at();
    // Both figures are on the page; nothing may invite adding them.
    expect(
      screen.getByText(/трансфери, не обществени поръчки/),
    ).toBeInTheDocument();
    expect(screen.getByText(/двете не се събират/)).toBeInTheDocument();
  });

  it("counts awarders in EIKs on both sides of its own ratio", () => {
    at();
    // „Възложители 66 … от 65 в сектора" shipped live: an EIK count over a body
    // count. Both sides must be the EIK count.
    expect(screen.getByText(/^от 66 в сектора$/)).toBeInTheDocument();
  });

  it("feeds the budget strip the SAME payout figure the hero shows", () => {
    budgetTileProps.mockClear();
    at();
    // Two fetches of the same quantity is how one page comes to show two vintages
    // of it. The strip takes the hero's numbers as props for that reason.
    expect(budgetTileProps).toHaveBeenCalledWith(
      expect.objectContaining({
        payoutEur: STATS.totalEur,
        payoutLabel: "2025",
      }),
    );
    expect(screen.getByTestId("agri-budget-bases")).toBeInTheDocument();
  });

  it("renders the scope picker even though the gate is mocked open", () => {
    at();
    expect(screen.getByTestId("agri-scope-picker")).toBeInTheDocument();
  });
});

describe("AgriPack — absence is never a zero", () => {
  it("names the political arm as not-computed rather than showing €0", () => {
    hub.data = { ...STATS, politicalBasisBuilt: false, politicalEur: null };
    at();
    expect(screen.getByText(/Все още не е изчислено/)).toBeInTheDocument();
    expect(screen.queryByText("€0")).not.toBeInTheDocument();
    hub.data = STATS;
  });

  it("omits the period from the band title while the payload is loading", () => {
    // „Изплатено по САР (всички години)" under a „Последна година" pill is a span
    // asserted before anything is known. It rendered exactly that.
    hub.data = undefined;
    at();
    expect(screen.getByText("Изплатено по САР")).toBeInTheDocument();
    expect(screen.queryByText(/Изплатено по САР \(/)).not.toBeInTheDocument();
    hub.data = STATS;
  });
});
