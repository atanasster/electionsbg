// This tile divides an ANNUAL appropriation by procurement measured from the contracts
// corpus, and the whole defect class lives in which year it picks and what it then says
// about that choice — neither of which a test on the pure helper can see.
//
// 1. It pinned to the NEWEST year in the budget node. Once the node gained 2026 that was
//    the CURRENT year, so a twelve-month €1,058,603,600 appropriation was divided by the
//    7 months of 2026 the corpus holds (€9,183,875) and rendered 0,9% — against 2025's
//    real 2,43%. The pass-through share IS this sector's thesis, so the sector's headline
//    sentence was out by 2.8×.
// 2. `latestCompleteFiscalYear` falls back to the current year when the node has nothing
//    older, and the caption asserts „последната приключила година" in words. Left
//    unconditional, that branch does not merely show the wrong number — it certifies it.
// 3. The budget figure must come from the SHARED series rule, or this tile and
//    RegionalBudgetTile beside it can name one year and show two different sums for it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

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

type Year = {
  fiscalYear: number;
  expenditure?: { amountEur: number } | null;
  expenditureLaw?: { amountEur: number } | null;
};
let years: Year[] = [];
vi.mock("@/data/budget/useBudget", () => ({
  useBudgetMinistryRollup: () => ({ data: { years } }),
}));

let totalEur: number | null = null;
const groupModel = vi.fn(() => ({ model: { totalEur } }));
vi.mock("@/data/procurement/useAwarderGroupModel", () => ({
  useAwarderGroupModel: (...args: unknown[]) =>
    (groupModel as unknown as (...a: unknown[]) => { model: unknown })(...args),
}));

vi.mock("@/lib/regionalAttributes", () => ({
  buildRegionalModelFromAggregates: () => null,
}));

const { RegionalPassThroughHero } = await import("./RegionalPassThroughHero");

const eur = (amountEur: number) => ({ amountEur });

/** The real МРРБ node on 2026-08-13: a complete 2025 and an enacted, unfinished 2026. */
const MRRB: Year[] = [
  { fiscalYear: 2025, expenditure: eur(1_058_603_611) },
  { fiscalYear: 2026, expenditure: eur(1_058_603_600) },
];

beforeEach(() => {
  lang = "bg";
  years = MRRB;
  totalEur = 25_715_993; // 2025's group procurement
  groupModel.mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-14T00:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const text = () =>
  (document.getElementById("regional-hero")?.textContent ?? "").replace(
    /\s+/g,
    " ",
  );

describe("RegionalPassThroughHero", () => {
  it("names the last COMPLETE year, not the newest one in the node", () => {
    render(<RegionalPassThroughHero />);
    expect(text()).toContain("През 2025 г.");
    expect(text()).not.toContain("През 2026 г.");
    // 25_715_993 / 1_058_603_611 = 2.43%, not 2026's 0.9%.
    expect(text()).toContain("2,4%");
  });

  it("windows the group-model call to that year, half-open", () => {
    render(<RegionalPassThroughHero />);
    // awarder_group_model is `date < COALESCE(p_to,…)`, so `to` is the NEXT
    // 1 January — a `2025-12-31` bound would silently drop the last day.
    expect(groupModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { from: "2025-01-01", to: "2026-01-01" },
      true,
    );
  });

  it("does NOT certify a complete basis when it fell back to the current year", () => {
    // A node carrying only its enacted current year — reachable because
    // data/budget/ministries/ is bucket-shipped, so a re-organised or newly
    // created admin unit can arrive with one row.
    years = [{ fiscalYear: 2026, expenditure: eur(1_058_603_600) }];
    totalEur = 9_183_875;
    render(<RegionalPassThroughHero />);
    expect(text()).toContain("През 2026 г.");
    expect(text()).not.toContain("последната приключила година");
    expect(text()).toContain("подценен");
  });

  it("shows the ЗДБ figure for the year, like RegionalBudgetTile beside it", () => {
    // The МОСВ-2024 shape: an отчет restating the appropriation ~73% wider than
    // the law. Reading `expenditure` directly would put a different number on
    // this tile than on the budget tile for the very same year.
    years = [
      {
        fiscalYear: 2025,
        expenditure: eur(104_230_071),
        expenditureLaw: eur(60_325_488),
      },
      { fiscalYear: 2026, expenditure: eur(1_058_603_600) },
    ];
    totalEur = 6_032_548; // exactly 10% of the ЗДБ figure
    render(<RegionalPassThroughHero />);
    expect(text()).toContain("10%");
  });

  it("reports a ratio above 100% instead of clamping it to a confident 100%", () => {
    // Only reachable when the basis has broken (a wrong reference year, an EIK
    // set that grew, an annex-inflated total). On a tile whose thesis is „the
    // procured slice is thin", a clamped 100% erases the only signal.
    totalEur = 1_450_000_000;
    render(<RegionalPassThroughHero />);
    expect(text()).toContain("137%");
    expect(text()).toContain("проверете базата");
  });

  it("renders nothing rather than a share of an absent budget", () => {
    years = [];
    render(<RegionalPassThroughHero />);
    expect(document.getElementById("regional-hero")).toBeNull();
  });

  it("gives the part-to-whole bar an accessible equivalent", () => {
    render(<RegionalPassThroughHero />);
    const bar = screen.getByRole("img");
    expect(bar.getAttribute("aria-label")).toContain("2,4%");
    expect(bar.getAttribute("aria-label")).toContain("2025");
  });

  it("says the same thing in English", () => {
    lang = "en";
    render(<RegionalPassThroughHero />);
    expect(text()).toContain("In 2025");
    expect(text()).toContain("the last complete year");
  });
});
