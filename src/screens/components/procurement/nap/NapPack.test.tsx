// Two invariants of the НАП card, neither of which any source scan can reach.
//
// 1. The PILL and the CARD name the same window. The shipped defect was that
//    they did not — /sector/revenue?pscope=y:2013 painted „2013" in the screen's
//    control above 2026's figures. `?pscope` is in the usePreserveParams
//    allowlist, so an off-list year is what an ordinary in-app link mints.
// 2. A PARTIAL year is marked wherever it is named. „a running year rendered as
//    a whole one" is what this card must never do, and the marker moved from the
//    retired year buttons into the title, so all three surfaces need pinning.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { bgCorpus as bgDict } from "@/locales/allKeys";
import type { NapComposition } from "@/data/procurement/useNap";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: "bg" };
    },
    t: (k: string) => (bgDict as Record<string, string>)[k] ?? k,
  }),
}));

const comp = (
  year: number,
  partial: boolean,
  asOf: string,
  totalTaxEur: number,
): NapComposition => ({
  year,
  asOf,
  partial,
  totalTaxEur,
  segments: [
    { id: "vat", eur: totalTaxEur * 0.5 },
    { id: "excise", eur: totalTaxEur * 0.3 },
    { id: "customs", eur: totalTaxEur * 0.2 },
  ] as NapComposition["segments"],
});

// Newest first, as useNap emits it: a running 2026 then three closed years.
const COMPOSITIONS = [
  comp(2026, true, "2026-06-30", 11_430_000_000),
  comp(2025, false, "2025-12-31", 22_770_000_000),
  comp(2024, false, "2024-12-31", 19_720_000_000),
  comp(2023, false, "2023-12-31", 17_560_000_000),
];

const state = { compositions: COMPOSITIONS, vat: null, isLoading: false };

vi.mock("@/data/procurement/useNap", async (orig) => ({
  ...(await orig<typeof import("@/data/procurement/useNap")>()),
  useNap: () => state,
}));

// The Митници cross-reference (the „who actually collects this" footnote) is a
// separate react-query call; stubbing it keeps this test off the network without
// touching the composition under test.
vi.mock("@/data/budget/useBudget", async (orig) => ({
  ...(await orig<typeof import("@/data/budget/useBudget")>()),
  useCustomsBreakdown: () => ({ data: undefined }),
}));

const { NapPack } = await import("./NapPack");

const at = (url: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  };

const show = (url: string) =>
  render(<NapPack eik="131063188" scopeWindow={{ from: null, to: null }} />, {
    wrapper: at(url),
  });

const nsPill = () => screen.getByRole("button", { name: "Последна година" });
const title = () =>
  screen.getByText(/Откъде идват данъчните приходи/).textContent ?? "";

describe("NapPack scope", () => {
  it("an on-list year moves the pill AND the card together", () => {
    show("/sector/revenue?pscope=y:2024");
    expect(screen.getByRole("combobox")).toHaveTextContent("2024");
    expect(title()).toContain("2024");
    expect(nsPill()).toHaveAttribute("aria-pressed", "false");
  });

  it("an OFF-list year resolves to the same window in both", () => {
    // y:2013 predates this corpus — the state the shipped defect rendered as
    // „2013" over 2026's figures.
    show("/sector/revenue?pscope=y:2013");
    expect(nsPill()).toHaveAttribute("aria-pressed", "true");
    expect(title()).toContain("2026");
    expect(screen.queryByText(/2013/)).not.toBeInTheDocument();
  });

  it("keeps the control, and says why, when the corpus fails to load", () => {
    Object.assign(state, { compositions: [] });
    try {
      show("/sector/revenue");
      expect(nsPill()).toBeInTheDocument();
      expect(
        screen.getByText(/Няма данни за данъчните приходи/),
      ).toBeInTheDocument();
    } finally {
      Object.assign(state, { compositions: COMPOSITIONS });
    }
  });
});

describe("NapPack partial year", () => {
  it("marks a running year in every place that names it", () => {
    show("/sector/revenue");
    // The title's marker, with the explanation the retired buttons carried.
    expect(title()).toMatch(/\(2026\*\)/);
    expect(
      screen.getByTitle(/частична година — натрупано до 2026-06-30/),
    ).toBeInTheDocument();
    // …and the two prose statements beneath it.
    expect(screen.getByText(/до момента/)).toBeInTheDocument();
    expect(screen.getByText(/натрупано до 2026-06-30/)).toBeInTheDocument();
  });

  it("marks nothing on a closed year", () => {
    show("/sector/revenue?pscope=y:2025");
    expect(title()).toMatch(/\(2025\)/);
    expect(title()).not.toContain("*");
    expect(screen.queryByText(/до момента/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/частична година/)).not.toBeInTheDocument();
  });
});
