// Gates for the shared body of /budget/revenue and /budget/spending.
//
// Both claims here are about a figure that is arithmetically right and false as
// a sentence — the class this whole module keeps producing:
//
//   1. A PART-YEAR bar beside closed years. FY2026 carries a June cumulative,
//      so drawn plainly it reads as revenue collapsing by half. It must be
//      labelled and must not set the scale.
//   2. The EU band is Eurostat's GENERAL-GOVERNMENT basis and the headline is
//      the МФ state budget. The page must say so, or the chip reads as a
//      comparison against the number printed above it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bgCorpus as bg } from "@/locales/allKeys";
import { BudgetCompositionScreen } from "./BudgetCompositionScreen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // The screen picks the label language off `i18n`, so a mock without it
    // renders nothing and every gate below fails for the wrong reason.
    i18n: { language: "bg" },
    t: (k: string, o?: Record<string, unknown>) => {
      const raw = (bg as Record<string, string>)[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

const SNAPSHOT = {
  fiscalYear: 2024,
  period: "2024-12",
  basis: "eur",
  sections: [
    {
      sectionCode: "I",
      kind: "revenue",
      series: "revenue",
      labelBg: "Приходи",
      labelEn: "Revenue",
      executedEur: 1000,
      plannedEur: 900,
      lines: [
        {
          ord: 0,
          depth: 0,
          isSubtotal: true,
          labelBg: "Данъчни",
          labelEn: "Tax",
          groupLabelBg: null,
          executedEur: 800,
        },
        {
          ord: 1,
          depth: 1,
          isSubtotal: false,
          labelBg: "ДДС",
          labelEn: "VAT",
          groupLabelBg: "Данъчни",
          executedEur: 500,
        },
        {
          ord: 2,
          depth: 0,
          isSubtotal: true,
          labelBg: "Неданъчни",
          labelEn: "Non-tax",
          groupLabelBg: null,
          executedEur: 200,
        },
      ],
    },
  ],
};

const SERIES = {
  basis: "eur",
  cumulative: true,
  points: [
    {
      fiscalYear: 2024,
      period: "2024-12",
      series: "revenue",
      executedEur: 1000,
      plannedEur: null,
    },
    // The part year, and deliberately BIGGER than the closed year. With a
    // smaller one, `peak` is the closed year either way and the gate below
    // passes even with the `!v.partial` filter deleted — mutation-proven. A
    // part year that outgrows a closed year is also the real case: revenue
    // rises year on year, so 2026-12 will land above 2025-12 long before
    // 2026 closes.
    {
      fiscalYear: 2026,
      period: "2026-06",
      series: "revenue",
      executedEur: 1600,
      plannedEur: null,
    },
  ],
};

const renderIt = (
  props: Partial<{
    kind: "revenue" | "expenditure";
    peerItem: "TR" | "TE";
  }> = {},
) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/budget/revenue?fy=2024"]}>
        <BudgetCompositionScreen
          kind={props.kind ?? "revenue"}
          peerItem={props.peerItem ?? "TR"}
          titleKey="budget_revenue_title"
          descriptionKey="budget_revenue_description"
          introKey="budget_revenue_intro"
          sourceKey="budget_revenue_source"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/** Reassigned per test; reset below so one case cannot leak into the next. */
let snapshotPayload: unknown = SNAPSHOT;

beforeEach(() => {
  snapshotPayload = SNAPSHOT;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("budget-hub-stats"))
        return {
          ok: true,
          json: async () => ({
            fiscalYear: 2024,
            yearsAvailable: [2024, 2026],
            peerBands: {
              TR: {
                year: 2025,
                bgPctGdp: 38.1,
                euAvgPctGdp: 46.4,
                rank: 24,
                total: 27,
              },
            },
          }),
        };
      if (url.includes("budget-series"))
        return { ok: true, json: async () => SERIES };
      return { ok: true, json: async () => snapshotPayload };
    }),
  );
});

/** The trend list only — "2026" also matches the year-chip button above it. */
const trendRow = async (year: string) => {
  const h = await screen.findByText(
    (bg as Record<string, string>).budget_comp_trend_h,
  );
  const list = h.parentElement!.querySelector("ul")!;
  return [...list.querySelectorAll("li")].find((li) =>
    li.textContent?.startsWith(year),
  )!;
};

describe("BudgetCompositionScreen", () => {
  it("labels a part-year figure rather than drawing it as a full one", async () => {
    renderIt();
    const row = await trendRow("2026");
    // Labelled with the period it actually reaches…
    expect(row.textContent).toMatch(/\(към 2026-06\)/);
    // …and drawn at a lighter weight, so it does not read as a collapse.
    expect(row.querySelector("span.bg-primary\\/40")).toBeTruthy();
  });

  it("does not let a part year set the scale", async () => {
    renderIt();
    const closed = await trendRow("2024");
    // The complete year is the peak, so its bar is full width. If the part year
    // were in the scale, this would be under 100%.
    const bar = closed.querySelector<HTMLElement>("span.bg-primary");
    expect(bar?.style.width).toBe("100%");
  });

  it("picks the section by series, not by position", async () => {
    // `budget_snapshot(fy,'expenditure')` returns TWO sections that are BOTH
    // kind = 'expenditure': §II Разходи and §III Вноска в бюджета на ЕС. Ordered
    // §III-first here on purpose — the page must still show §II's €900, never
    // §III's €100 over an empty breakdown. §III genuinely carries no lines in
    // any year of the corpus, so getting this wrong looks exactly like a real
    // data gap.
    snapshotPayload = {
      fiscalYear: 2024,
      period: "2024-12",
      sections: [
        {
          sectionCode: "III",
          kind: "expenditure",
          series: "euContribution",
          labelBg: "Вноска в бюджета на ЕС",
          labelEn: "EU contribution",
          executedEur: 100,
          plannedEur: 100,
          lines: [],
        },
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
    renderIt({ kind: "expenditure", peerItem: "TE" });
    // Scoped: the donut's legend renders the same label, so an unscoped query
    // now matches twice. What this gate is about is which SECTION the page
    // resolved, and the breakdown list is where that shows.
    const list = await screen.findByTestId("budget-breakdown");
    expect(within(list).getByText("Текущи разходи")).toBeTruthy();
    expect(screen.queryByText("€100")).toBeNull();
  });

  it("shows only the top level in the breakdown, never the nested lines", async () => {
    renderIt();
    const list = await screen.findByTestId("budget-breakdown");
    // ДДС is depth 1 and already inside Данъчни. Rendering both IN THIS LIST
    // would double the visible total.
    //
    // Scoped to the list on purpose: the donut above it renders depth-1 lines
    // deliberately, and drops their parent so the two levels are never both
    // counted (budgetSlices.test.ts holds that). The rule this gate protects
    // is about the BAR LIST, which shows depth-0 and has no such compensation.
    expect(within(list).getByText("Данъчни")).toBeTruthy();
    expect(within(list).queryByText("ДДС")).toBeNull();
  });

  it("states that the EU band is a different perimeter", async () => {
    renderIt();
    const note = await screen.findByText(/Сравнението е на база Евростат/);
    expect(note.textContent).toMatch(/„Държавно управление“/);
    expect(note.textContent).toMatch(/различни съвкупности/);
  });
});
