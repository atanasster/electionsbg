// The iceberg tile is a RATIO, and every defect it has ever had was in the
// denominator rather than the numerator. Until 2026-08-19 it divided a
// scope-windowed procurement figure by the NEWEST budget year regardless of the
// scope, so `?pscope=y:2018` rendered „€77,5 млн. … ~4%" when the true 2018 share
// is 11.7% — understated 3.2×, and always in the direction that flatters the
// tile's own „iceberg" thesis, which is what made it survive review.
//
// So these tests are about the denominator: which year it is, when there isn't
// one, and whether the copy beside it describes the band actually drawn.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MvrBudgetBridgeTile } from "./MvrBudgetBridgeTile";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      get language() {
        return lang;
      },
    },
  }),
}));

// The МВР node as it really is: starts at 2018, and 2026 is ~3.2× 2018.
const YEARS = [
  { fiscalYear: 2018, expenditure: { amountEur: 662_838_795 } },
  { fiscalYear: 2019, expenditure: { amountEur: 774_499_931 } },
  { fiscalYear: 2024, expenditure: { amountEur: 1_414_912_237 } },
  { fiscalYear: 2025, expenditure: { amountEur: 2_114_529_228 } },
  { fiscalYear: 2026, expenditure: { amountEur: 2_115_233_200 } },
];

vi.mock("@/data/budget/useBudget", () => ({
  useBudgetMinistryRollup: () => ({ data: { years: YEARS } }),
}));

beforeEach(() => {
  lang = "bg";
});

const text = () => document.body.textContent ?? "";

describe("MvrBudgetBridgeTile — which budget year the share divides by", () => {
  it("anchors on the requested year, not the newest", () => {
    render(
      <MvrBudgetBridgeTile procEur={77_500_531} perYear budgetYear={2018} />,
    );
    // 77.5 / 662.8 = 11.7% → „~12%". Against the 2026 budget it would be ~4%.
    expect(text()).toContain("2018");
    expect(text()).toMatch(/~12%/);
    expect(text()).not.toMatch(/~4%/);
  });

  it("falls back to the newest year when no year is asked for", () => {
    render(
      <MvrBudgetBridgeTile
        procEur={53_150_771}
        perYear={false}
        budgetYear={null}
      />,
    );
    expect(text()).toContain("2026");
    expect(text()).toMatch(/~3%/);
  });

  it("publishes NO share for a year the series does not reach", () => {
    // ⚠ THE REGRESSION THIS FILE EXISTS FOR. ?pscope offers every year from 2011
    // while the МВР node starts at 2018, so seven selectable years have no budget
    // to be a share of. Dividing by the newest one anyway reproduces the original
    // defect at ≥3.19×, and — because the fallback makes anchor === newest — the
    // „×3,2 от 2018" growth pill comes back to corroborate it.
    render(
      <MvrBudgetBridgeTile procEur={85_100_000} perYear budgetYear={2017} />,
    );
    expect(text()).toMatch(/Няма приет бюджет на МВР за 2017/);
    expect(text()).not.toMatch(/върхът на айсберга/);
    expect(text()).not.toMatch(/~4%/);
  });

  it("shows the growth pill only when the anchor IS the newest year", () => {
    const { unmount } = render(
      <MvrBudgetBridgeTile procEur={53_150_771} perYear budgetYear={2026} />,
    );
    expect(text()).toMatch(/×3,2/);
    unmount();
    document.body.innerHTML = "";
    // „€662,8 млн., бюджет 2018 г., ×3,2 от 2018" is nonsense.
    render(
      <MvrBudgetBridgeTile procEur={77_500_531} perYear budgetYear={2018} />,
    );
    expect(text()).not.toMatch(/×3,2/);
  });

  it("says so when the anchor year is still running", () => {
    const y = new Date().getFullYear();
    render(<MvrBudgetBridgeTile procEur={50_000_000} perYear budgetYear={y} />);
    // Only meaningful while the series actually reaches the current year.
    if (YEARS.some((r) => r.fiscalYear === y))
      expect(text()).toMatch(/още тече/);
  });
});

describe("MvrBudgetBridgeTile — the copy must describe the bar it draws", () => {
  it("prices the payroll band at the width actually rendered", () => {
    // `personnelPct` is clamped by `100 - procPct`, so a wide window pushes it well
    // under the ~90% estimate. A hardcoded „~90%" would then label a band nobody
    // drew — measured drift up to 11.8pp.
    render(
      <MvrBudgetBridgeTile
        procEur={500_000_000}
        perYear={false}
        budgetYear={2018}
      />,
    );
    // 500.0 / 662.8 = 75.4% procurement → the payroll band can only be ~25%.
    expect(text()).toMatch(/Заплати ~2[0-9]% \(оценка\)/);
    expect(text()).not.toMatch(/Заплати ~90%/);
  });

  it("refuses the iceberg conclusion when the share exceeds the budget", () => {
    render(
      <MvrBudgetBridgeTile
        procEur={900_000_000}
        perYear={false}
        budgetYear={2018}
      />,
    );
    expect(text()).toMatch(/надхвърлят целия/);
    expect(text()).toMatch(/проверете базата/);
    expect(text()).not.toMatch(/върхът на айсберга/);
  });

  it("paints no procurement slice when there is no share to show", () => {
    render(<MvrBudgetBridgeTile procEur={0} perYear budgetYear={2018} />);
    // The 2% floor exists to keep a real-but-tiny slice visible, never to
    // manufacture one the legend prices at „—".
    const bar = document.querySelector('[role="img"]');
    const widths = [...(bar?.children ?? [])].map(
      (el) => (el as HTMLElement).style.width,
    );
    expect(widths).not.toContain("2%");
    expect(text()).toContain("—");
  });

  it("renders the English copy in English", () => {
    lang = "en";
    render(
      <MvrBudgetBridgeTile procEur={85_100_000} perYear budgetYear={2017} />,
    );
    // A caption cannot be checked in one language — the water tile shipped a BG
    // fix and an EN regression in the same commit.
    expect(text()).toMatch(/no enacted МВР budget for 2017/);
    expect(text()).not.toMatch(/Няма приет бюджет/);
  });
});
