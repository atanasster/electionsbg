// The wiring, not the figures — `indicatorsHubFigures.test.ts` owns those.
//
// ⚠️ WHAT THIS EXISTS FOR: the band↔grid rule here is enforced across TWO files and is
// invisible to a unit test of the builder. The band promotes four indicators OUT of a
// twelve-tile grid, so a promotion that failed to reach the grid prints each of the four
// twice on one page, and a promotion that over-reached drops one off it entirely — both at
// a 200, with every builder assertion green.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { IndicatorsLandingScreen } from "./IndicatorsLandingScreen";
import { BAND_INDICATORS } from "./indicatorsHubFigures";
import { LANDING_KPI_ORDER } from "./indicatorsRegistry";

/** The four series the band reads, verbatim from data/macro.json (2026-08-26), plus one the
 *  grid keeps — enough to prove the split without carrying the whole payload. */
const MACRO = {
  fetchedAt: "2026-08-26T00:00:00.000Z",
  sources: {},
  country: "BG",
  indicators: {
    gdpGrowth: {
      titleBg: "Растеж на реалния БВП",
      titleEn: "Real GDP growth",
      unitLabelBg: "% спрямо същия период предходна година (реален, SCA)",
      unitLabelEn: "% on the same quarter a year earlier",
      cadence: "quarterly",
      source: "eurostat",
    },
    inflation: {
      titleBg: "Инфлация (ХИПЦ)",
      titleEn: "Inflation (HICP)",
      unitLabelBg: "% спрямо предходната година (ХИПЦ, тримес. ср.)",
      unitLabelEn: "% on the previous year",
      cadence: "quarterly",
      source: "eurostat",
    },
    unemployment: {
      titleBg: "Безработица",
      titleEn: "Unemployment",
      unitLabelBg: "% от активното население (сезонно изгладено)",
      unitLabelEn: "% of the active population",
      cadence: "quarterly",
      source: "eurostat",
    },
    govDebt: {
      titleBg: "Брутен държавен дълг",
      titleEn: "Gross government debt",
      unitLabelBg: "% от БВП",
      unitLabelEn: "% of GDP",
      cadence: "quarterly",
      source: "eurostat",
    },
    budgetBalance: {
      titleBg: "Бюджетен баланс",
      titleEn: "Budget balance",
      unitLabelBg: "% от БВП (нето кредит/заем, SCA)",
      unitLabelEn: "% of GDP",
      cadence: "quarterly",
      source: "eurostat",
    },
  },
  series: {
    gdpGrowth: [{ year: 2026, quarter: 2, period: "2026-Q2", value: 2.7 }],
    inflation: [{ year: 2026, quarter: 2, period: "2026-Q2", value: 5.83 }],
    unemployment: [{ year: 2026, quarter: 1, period: "2026-Q1", value: 3 }],
    govDebt: [{ year: 2026, quarter: 1, period: "2026-Q1", value: 28.5 }],
    budgetBalance: [{ year: 2026, quarter: 1, period: "2026-Q1", value: -7.6 }],
  },
  latestMonthly: {},
};

const mount = (data: unknown = MACRO) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("macro.json")
        ? { ok: true, status: 200, json: async () => data }
        : { ok: false, status: 404, json: async () => null },
    ),
  );
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/indicators"]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return render(<IndicatorsLandingScreen />, { wrapper: Wrapper });
};

afterEach(() => vi.unstubAllGlobals());

const bandCells = () => [
  ...document.querySelectorAll("[data-hub-head] [data-kpi-cell]"),
];
const gridTiles = () => [
  ...(document
    .querySelector('[data-og="indicators-kpi-grid"]')
    ?.querySelectorAll(":scope > div > *") ?? []),
];

describe("IndicatorsLandingScreen", () => {
  it("renders a band cell per promoted indicator", async () => {
    mount();
    await waitFor(() => expect(bandCells()).toHaveLength(4));
    // Each carries a unit AND a period — the pairing that stops four percentages of
    // different things reading as one scale.
    for (const c of bandCells()) {
      // ⚠️ THE UNIT, not just a „%" — the value string alone contains one, so `/%/` was
      // satisfied by the figure and asserted nothing about the basis.
      expect(c.textContent, "a cell lost its unit").toMatch(
        /% (?:спрямо|от|of|on)/,
      );
      expect(c.textContent, "a cell lost its period").toMatch(/тр\.|Q\d/);
    }
  });

  it("REMOVES the promoted four from the grid below", async () => {
    // §3.1 rule 5. Without this the page prints each of the four twice — once in the head
    // and once in the grid — which is what the band was extracted from.
    mount();
    await waitFor(() => expect(bandCells()).toHaveLength(4));
    // ⚠️ THE COUNT FIRST, because a substring check alone cannot see this. `KpiTile` returns
    // null for an indicator the payload has no meta or no point for, so the grid silently
    // renders only what it can — and the fixture carries five series. If the filter were
    // removed the grid would render all five; with it, one. Asserting the LENGTH is what
    // makes the per-title clause below non-vacuous.
    const unpromoted = LANDING_KPI_ORDER.filter(
      (k) => !BAND_INDICATORS.includes(k) && k in MACRO.series,
    );
    expect(
      gridTiles(),
      "the grid still renders a promoted indicator",
    ).toHaveLength(unpromoted.length);

    const gridText = gridTiles()
      .map((x) => x.textContent ?? "")
      .join(" ");
    for (const key of BAND_INDICATORS) {
      // ⚠️ `titleEn`, because the harness's i18n default is `en`. This loop compared against
      // the BULGARIAN title — a string that never appears in the rendered output — so it
      // held against any implementation, including one that removed nothing. The sibling
      // clause below was fixed and this one was missed on the first pass.
      const title =
        MACRO.indicators[key as keyof typeof MACRO.indicators]?.titleEn;
      if (title)
        expect(
          gridText,
          `${key} is in both the band and the grid`,
        ).not.toContain(title);
    }
  });

  it("keeps every UNPROMOTED indicator in the grid", async () => {
    // The other half: over-reaching would drop an indicator off the page altogether.
    mount();
    await waitFor(() => expect(bandCells()).toHaveLength(4));
    const gridText = gridTiles()
      .map((x) => x.textContent ?? "")
      .join(" ");
    expect(gridText).toContain(MACRO.indicators.budgetBalance.titleEn);
    // Non-vacuity: the grid list really is longer than the band's four.
    expect(LANDING_KPI_ORDER.length).toBeGreaterThan(BAND_INDICATORS.length);
  });

  it("renders the note exactly once", async () => {
    mount();
    await waitFor(() => expect(bandCells()).toHaveLength(4));
    expect(screen.getAllByText(/indicators_kpi_note/)).toHaveLength(1);
  });
});
