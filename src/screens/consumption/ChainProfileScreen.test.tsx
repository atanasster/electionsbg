// The four staleness branches on /consumption/chain/:eik — the whole of T2c.
//
// The constraint they implement: a chain that stops filing keeps its page (T2b),
// but a retained price must NEVER be presented as today's. Concretely, the two
// failures this pins are both comparisons rather than displays:
//
//   - the „най-евтина" badge, which claims a price is the cheapest on the market;
//   - the struck-through market minimum beside every other row, which puts a
//     price observed up to 30 days ago next to TODAY's cross-chain minimum.
//
// The second shipped in the first cut of T2c and survived review of the first:
// the notice two elements above it says in words that these prices are excluded
// from exactly that comparison, while the row went on making it. So both are
// asserted here, separately.
//
// See docs/plans/prices-chain-absence-v1.md T2c.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ChainProductsFile } from "@/data/prices/usePrices";

const LATEST = "2026-08-14";

const product = (
  over: Partial<ChainProductsFile["products"][number]> = {},
) => ({
  slug: "hlyab-bql-650g",
  title: "Хляб бял 650 г",
  netQty: 650,
  netUnit: "g",
  price: 1.29,
  // Deliberately NOT the cheapest, so the struck-through market minimum is the
  // element under test.
  marketMin: 0.99,
  pctSinceEuro: 3.2,
  asOf: LATEST,
  ...over,
});

let payload: ChainProductsFile;

vi.mock("@/data/prices/usePrices", async () => {
  const actual = await vi.importActual<
    typeof import("@/data/prices/usePrices")
  >("@/data/prices/usePrices");
  return {
    ...actual,
    useNationalChains: () => ({ data: undefined }),
    useChainProducts: () => ({ data: payload }),
  };
});
// The copy under test is Bulgarian-first, and the screen picks a language from
// i18n. Without this the whole file renders ENGLISH and every Bulgarian
// assertion below is vacuous — `queryByText("най-евтина")` in particular would
// return null whether or not the badge was suppressed, which is the exact shape
// of a test that passes on the defect.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "bg" }, t: (k: string) => k }),
}));
vi.mock("@/data/procurement/useCompanyProfile", () => ({
  useCompanyProfile: () => ({ data: undefined }),
}));

const { ChainProfileScreen } = await import("./ChainProfileScreen");

const draw = () =>
  render(
    <MemoryRouter initialEntries={["/consumption/chain/130007884"]}>
      <ChainProfileScreen />
    </MemoryRouter>,
  );

describe("ChainProfileScreen — staleness", () => {
  it("a chain that filed today shows the comparison and no notice", () => {
    payload = {
      products: [product()],
      asOf: LATEST,
      latestDate: LATEST,
      stale: false,
      beyondCeiling: false,
    };
    draw();

    expect(screen.getByText("Хляб бял 650 г")).toBeTruthy();
    // The market minimum IS shown — the chain is current, so the comparison is
    // legitimate.
    expect(screen.getByText(/0[.,]99/)).toBeTruthy();
    expect(screen.queryByText(/Последните данни/)).toBeNull();
  });

  it("a stale chain keeps its products but loses BOTH comparisons", () => {
    payload = {
      products: [product({ asOf: "2026-08-10" })],
      asOf: "2026-08-10",
      latestDate: LATEST,
      stale: true,
      beyondCeiling: false,
    };
    draw();

    // The page survives — that is T2b.
    expect(screen.getByText("Хляб бял 650 г")).toBeTruthy();
    // …and says when the data is from.
    expect(screen.getByText(/Последните данни/)).toBeTruthy();

    // ⚠️ The two comparisons must both be gone. The chain's OWN price stays
    // (it is a dated fact, not a claim about the market); today's market
    // minimum must not appear beside it.
    expect(screen.getByText(/1[.,]29/)).toBeTruthy();
    expect(screen.queryByText(/0[.,]99/)).toBeNull();
    expect(screen.queryByText("най-евтина")).toBeNull();
  });

  it("a stale chain that WOULD be cheapest still gets no badge", () => {
    // Guards the badge independently of the strikethrough: with price below
    // marketMin the pre-fix code rendered „най-евтина" on a days-old price.
    payload = {
      products: [product({ price: 0.89, marketMin: 0.99, asOf: "2026-08-01" })],
      asOf: "2026-08-01",
      latestDate: LATEST,
      stale: true,
      beyondCeiling: false,
    };
    draw();

    expect(screen.queryByText("най-евтина")).toBeNull();
  });

  it("past the ceiling the chain is named and dated, with no prices", () => {
    payload = {
      products: [],
      asOf: "2026-06-01",
      latestDate: LATEST,
      stale: true,
      beyondCeiling: true,
    };
    draw();

    expect(screen.getByText(/Последните данни/)).toBeTruthy();
    expect(screen.getByText(/не показваме цени/)).toBeTruthy();
    expect(screen.queryByText("Хляб бял 650 г")).toBeNull();
  });

  it("an empty-but-not-past-the-ceiling chain says so without promising prices", () => {
    // The reason is picked by beyondCeiling; the BRANCH is whether prices are
    // shown. Before the fix this case promised "the prices shown are the last
    // ones filed" above an empty list.
    payload = {
      products: [],
      asOf: "2026-08-12",
      latestDate: LATEST,
      stale: true,
      beyondCeiling: false,
    };
    draw();

    expect(screen.getByText(/Нямаме съпоставими цени/)).toBeTruthy();
    expect(screen.queryByText(/не показваме цени/)).toBeNull();
  });

  it("a pre-T2c payload (no staleness fields) renders without a notice", () => {
    // React Query holds blobs at staleTime: Infinity, so an older payload can
    // still be in cache after a deploy. It must not crash or invent a date.
    payload = { products: [product({ asOf: undefined })] } as ChainProductsFile;
    draw();

    expect(screen.getByText("Хляб бял 650 г")).toBeTruthy();
    expect(screen.queryByText(/Последните данни/)).toBeNull();
  });
});
