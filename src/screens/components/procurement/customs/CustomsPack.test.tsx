// The invariant every other gate around packOwnsScope only approximates: the
// PILL and the CARD name the same window.
//
// The shipped defect was that they did not — /sector/customs?pscope=y:2022
// painted „2022" in the screen's control above „Откъде идват митническите
// приходи (2025)" and €7,4 млрд. Source scans (sectorDashboards.test.ts) prove
// the wiring exists; only a render proves it produces one value. `?pscope` is in
// the usePreserveParams allowlist, so an off-list year is not a hypothetical —
// it is what an ordinary in-app link from /procurement mints.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { bgCorpus as bgDict } from "@/locales/allKeys";
import type { CustomsBreakdownFile } from "@/data/budget/types";

// The house i18n mock (BudgetMinistryScreen.test.tsx): the real corpus, pinned to
// bg, so the assertions below read the Bulgarian a Bulgarian reader sees.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: "bg" };
    },
    t: (k: string) => (bgDict as Record<string, string>)[k] ?? k,
  }),
}));

const YEARS = [2025, 2024, 2023, 2022];

const file = (fiscalYear: number, total: number): CustomsBreakdownFile =>
  ({
    fiscalYear,
    asOf: `${fiscalYear}-12-31`,
    currency: "EUR",
    lines: [
      { id: "total_collected", amountEur: total },
      { id: "excise_total", amountEur: total * 0.5, parent: "total_collected" },
      {
        id: "import_vat_total",
        amountEur: total * 0.45,
        parent: "total_collected",
      },
    ],
    customsByCountry: [],
  }) as unknown as CustomsBreakdownFile;

const BY_YEAR: Record<number, CustomsBreakdownFile> = {
  2025: file(2025, 7_427_792_804),
  2024: file(2024, 7_057_412_965),
  2023: file(2023, 6_392_273_357),
  2022: file(2022, 6_850_135_237),
};

const state = { years: YEARS, byYear: BY_YEAR, isLoading: false };

vi.mock("@/data/procurement/useCustoms", async (orig) => ({
  ...(await orig<typeof import("@/data/procurement/useCustoms")>()),
  useCustoms: () => state,
  useExciseRegister: () => ({ data: undefined }),
  useExciseWarehouseMap: () => ({ data: undefined }),
}));

const { CustomsPack } = await import("./CustomsPack");

const at = (url: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  };

const show = (url: string) =>
  render(
    <CustomsPack eik="000627597" scopeWindow={{ from: null, to: null }} />,
    { wrapper: at(url) },
  );

const nsPill = () => screen.getByRole("button", { name: "Последна година" });
const picker = () => screen.getByRole("combobox");
const cardYear = () =>
  screen
    .getByText(/Откъде идват митническите приходи/)
    .textContent?.match(/\((\d{4})\)/)?.[1];

describe("CustomsPack scope", () => {
  it("an on-list year moves the pill AND the card together", () => {
    show("/sector/customs?pscope=y:2022");
    expect(picker()).toHaveTextContent("2022");
    expect(cardYear()).toBe("2022");
    expect(nsPill()).toHaveAttribute("aria-pressed", "false");
  });

  it("an OFF-list year resolves to the same window in both", () => {
    // y:2019 is valid on /procurement and absent from this corpus — the exact
    // inbound state usePreserveParams mints. Neither half may show 2019.
    show("/sector/customs?pscope=y:2019");
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(cardYear()).toBe("2025");
    expect(screen.queryByText(/2019/)).not.toBeInTheDocument();
  });

  it("all-years resolves too — this corpus has no cross-year aggregate", () => {
    show("/sector/customs?pscope=all");
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(cardYear()).toBe("2025");
  });

  it("defaults to the latest year with no param", () => {
    show("/sector/customs");
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(cardYear()).toBe("2025");
  });

  it("keeps the control while the corpus is still loading", () => {
    // The screen has already dropped its own control on the strength of this
    // pack owning one, so a skeleton must not take the page's only time control
    // with it.
    Object.assign(state, { isLoading: true });
    try {
      show("/sector/customs");
      expect(nsPill()).toBeInTheDocument();
    } finally {
      Object.assign(state, { isLoading: false });
    }
  });

  it("keeps the control, and says why, when the corpus fails to load", () => {
    Object.assign(state, { years: [], byYear: {}, isLoading: false });
    try {
      show("/sector/customs");
      expect(nsPill()).toBeInTheDocument();
      expect(
        screen.getByText(/Няма данни за митническите приходи/),
      ).toBeInTheDocument();
    } finally {
      Object.assign(state, { years: YEARS, byYear: BY_YEAR });
    }
  });
});
