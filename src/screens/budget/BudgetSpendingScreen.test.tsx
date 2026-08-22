// Gates for /budget/spending — the thin wrapper.
//
// The shared body is already gated by BudgetCompositionScreen.test.tsx. What is
// left is exactly what a wrapper owns, and it is the kind of defect that ships:
// every value it passes is valid for the OTHER page, so a copy-paste from the
// revenue wrapper renders a complete, plausible, wrong page with nothing red.
//
//   * `peerItem` — TR's band (38.1% of GDP, rank 24) is a real Eurostat figure
//     sitting under a spending heading. TE's is 41.7% / rank 23.
//   * `kind` — asking the server for the revenue section would show the money
//     COMING IN on the page about money going out, at a 200.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bgCorpus as bg } from "@/locales/allKeys";
import { BudgetSpendingScreen } from "./BudgetSpendingScreen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: uiLanguage };
    },
    t: (k: string, o?: Record<string, unknown>) => {
      const raw = (bg as Record<string, string>)[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

const SNAPSHOT = {
  fiscalYear: 2024,
  period: "2024-12",
  sections: [
    {
      sectionCode: "II",
      kind: "expenditure",
      series: "expenditure",
      labelBg: "Разходи",
      labelEn: "Expenditure",
      executedEur: 900,
      plannedEur: 850,
      lines: [
        {
          ord: 0,
          depth: 0,
          isSubtotal: true,
          labelBg: "Текущи разходи",
          labelEn: "Current",
          groupLabelBg: null,
          executedEur: 900,
        },
      ],
    },
  ],
};

/** Reassigned per test; reset below so one case cannot leak into the next. */
let snapshotPayload: unknown = SNAPSHOT;
/** Reassigned per test — the label branch reads it. */
let uiLanguage = "bg";

beforeEach(() => {
  snapshotPayload = SNAPSHOT;
  uiLanguage = "bg";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("budget-hub-stats"))
        return {
          ok: true,
          json: async () => ({
            fiscalYear: 2024,
            yearsAvailable: [2024],
            peerBands: {
              TR: {
                year: 2025,
                bgPctGdp: 38.1,
                euAvgPctGdp: 46.4,
                rank: 24,
                total: 27,
              },
              TE: {
                year: 2025,
                bgPctGdp: 41.7,
                euAvgPctGdp: 49.5,
                rank: 23,
                total: 27,
              },
            },
          }),
        };
      if (url.includes("budget-series"))
        return { ok: true, json: async () => ({ basis: "eur", points: [] }) };
      return { ok: true, json: async () => snapshotPayload };
    }),
  );
});

const renderIt = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/budget/spending?fy=2024"]}>
        <BudgetSpendingScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const renderEn = () => {
  uiLanguage = "en";
  return renderIt();
};

describe("BudgetSpendingScreen", () => {
  it("falls back to the Bulgarian label when the English one is blank", async () => {
    // An unmapped КФП line stores the EMPTY STRING, not NULL — so `??` sails
    // past it and the row renders with an amount, a share and no name. This is
    // „Трансфери (нето)", 58% of expenditure, blank on /en for FY2021-2024.
    snapshotPayload = {
      ...SNAPSHOT,
      sections: [
        {
          ...SNAPSHOT.sections[0],
          lines: [{ ...SNAPSHOT.sections[0].lines[0], labelEn: "" }],
        },
      ],
    };
    renderEn();
    // Scoped to the breakdown list: the donut's legend above it applies the
    // SAME fallback, so an unscoped query now matches twice. Both falling back
    // is the correct behaviour — a blank legend row on /en would be the same
    // defect in a second place.
    const list = await screen.findByTestId("budget-breakdown");
    expect(within(list).getByText("Текущи разходи")).toBeTruthy();
  });

  it("shows the EXPENDITURE peer band, not revenue's", async () => {
    renderIt();
    // TE. Both bands are in the fixture, so passing TR renders 38.1 / №24 —
    // true figures about the wrong series.
    const line = await screen.findByText(/41\.7% от БВП/);
    expect(line.textContent).toMatch(/№23 от 27/);
    expect(line.textContent).not.toMatch(/38\.1/);
  });

  it("carries its own copy, not the revenue page's", async () => {
    // Four of the six props are plain i18n keys. Left on revenue's by a
    // copy-paste, this page renders €24.8bn of spending under „Откъде идват
    // парите" and passes every other gate in this file.
    renderIt();
    const dict = bg as Record<string, string>;
    // findAll: the title is in both the <h1> and the breadcrumb.
    expect(
      (await screen.findAllByText(dict.budget_spending_title)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText(dict.budget_revenue_title)).toHaveLength(0);
    expect(screen.getByText(dict.budget_spending_intro)).toBeTruthy();
    expect(screen.getByText(dict.budget_spending_source)).toBeTruthy();
  });

  it("asks the server for the expenditure section", async () => {
    renderIt();
    // waitFor on the URL itself, not on rendered text: keyed on the text, a
    // wrong `kind` fails by TIMEOUT before this assertion ever runs, so the
    // gate reports a rendering problem rather than the request it is about.
    await waitFor(() =>
      expect(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some((c) =>
          String(c[0]).includes("budget-snapshot"),
        ),
      ).toBe(true),
    );
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("budget-snapshot"));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[urls.length - 1]).toMatch(/kind=expenditure/);
  });
});
