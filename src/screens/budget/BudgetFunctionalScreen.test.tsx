// Gates for /budget/functional.
//
// This page reports a DIFFERENT PERIMETER from every other page in the module —
// Eurostat's S13 (state + municipalities + social funds, €41.06bn on FY2024)
// against the state budget's €24.78bn. Three failures follow from that, and one
// more from the corpus's shape:
//
//   * DROPPING THE PERIMETER NOTE. The reader concludes the site cannot add up,
//     or reads GF07 as „what the state spends on health".
//   * OFFERING THE MODULE'S YEAR LIST. COFOG stops at 2024 while the КФП feed
//     reaches 2026, so the default year would have no breakdown at all.
//   * READING THE LABELS FROM THE CORPUS. They are NULL on every row of every
//     year; the page would render „GF10".
//   * A YEAR PAST COVERAGE READING AS ZERO SPENDING rather than as no data.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import bgDict from "@/locales/bg/translation.json";
import { BudgetFunctionalScreen } from "./BudgetFunctionalScreen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "bg" },
    t: (k: string, o?: Record<string, unknown>) => {
      const raw = (bgDict as Record<string, string>)[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

const dict = bgDict as Record<string, string>;

/** ⚠️ WHAT THE SCREEN HANDS THE CHART, captured — because nothing else can see
 *  it. `ResponsiveContainer` is 0-wide under the ResizeObserver stub so the
 *  chart renders nothing, and the ranked `<ul>` beside it carries all ten
 *  labels whatever the chart was given. Measured: without this, a mutation
 *  slicing the bar set to seven at the CALL SITE left all twenty tests green —
 *  the exact gap the data-layer extraction was supposed to close and did not,
 *  because the screen is where the call happens. */
let chartBars: Array<{ code: string; label: string; pct: number }> = [];

vi.mock("./BudgetFunctionalChart", () => ({
  BudgetFunctionalChart: (props: { bars: typeof chartBars }) => {
    chartBars = props.bars;
    return <div data-testid="functional-chart" />;
  },
}));
const sp = (v: string | null) => (v ?? "").replace(/\u00a0/g, " ");

/** FY2024, verbatim shape from `budget_cofog_list(2024,'eur')`: ten rows,
 *  TOTAL excluded, every label NULL. */
const FY2024 = {
  fiscalYear: 2024,
  basis: "eur",
  perimeter: "S13 — general government (state + municipalities + social funds)",
  source: "Eurostat gov_10a_exp",
  totalEur: 41059600000,
  rows: [
    {
      code: "GF10",
      nameBg: null,
      nameEn: null,
      amount: 15091900000,
      pctOfTotal: 36.756081403618154,
    },
    {
      code: "GF04",
      nameBg: null,
      nameEn: null,
      amount: 6105900000,
      pctOfTotal: 14.870821927149802,
    },
    {
      code: "GF07",
      nameBg: null,
      nameEn: null,
      amount: 5618400000,
      pctOfTotal: 13.683523463453126,
    },
  ],
};

let payload: unknown = FY2024;

beforeEach(() => {
  chartBars = [];
  payload = FY2024;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("budget-hub-stats")
        ? {
            ok: true,
            json: async () => ({
              fiscalYear: 2026,
              // The module reaches 2026; COFOG stops at 2024. The gap is the
              // point of the fixture.
              yearsAvailable: [2024, 2025, 2026],
              cofogYears: [2023, 2024],
            }),
          }
        : { ok: true, json: async () => payload },
    ),
  );
});

const renderIt = (search = "") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/budget/functional${search}`]}>
        <BudgetFunctionalScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("BudgetFunctionalScreen", () => {
  it("declares the perimeter before any figure", async () => {
    renderIt();
    const note = await screen.findByText(/ЦЕЛИЯТ сектор/);
    expect(sp(note.textContent)).toContain("€41 059 600 000");
    // Named as a different perimeter, not as a contradiction — and NOT as a
    // sum of three parts: S13 is consolidated, so „заедно" would tell a reader
    // the €41bn is the state's plus the municipalities' plus the funds'.
    expect(note.textContent).toMatch(/консолидирано/);
    expect(note.textContent).toMatch(/обхватът е различен/);
    expect(note.textContent).not.toMatch(/фондове заедно/);
    // …and it sits above the list.
    const list = document.querySelector("ul")!;
    expect(
      note.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("defaults to COFOG's newest year, not the module's", async () => {
    // hub-stats says the module is on 2026; COFOG stops at 2024. Using the
    // module's year opens the page empty on every visit.
    renderIt();
    await screen.findByText(dict.cofog_GF10);
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("budget-functional"));
    expect(urls[urls.length - 1]).toMatch(/fy=2024\b/);
    expect(urls[urls.length - 1]).not.toMatch(/fy=2026\b/);
  });

  it("offers only the years COFOG actually covers", async () => {
    renderIt();
    await screen.findByText(dict.cofog_GF10);
    const chips = [...document.querySelectorAll("button")]
      .map((b) => b.textContent)
      .filter((v) => /^\d{4}$/.test(v ?? ""));
    expect(chips).toEqual(["2023", "2024"]);
    expect(chips).not.toContain("2026");
  });

  it("labels the divisions rather than printing their codes", async () => {
    renderIt();
    // Every `nameBg`/`nameEn` in the payload is NULL.
    // Rendered from `cofog_GF10` in the bundle — NOT from a second copy in
    // TypeScript, which drifted from these on two of the ten.
    expect(await screen.findByText(dict.cofog_GF10)).toBeTruthy();
    expect(screen.getByText(dict.cofog_GF07)).toBeTruthy();
    expect(screen.queryByText("GF10")).toBeNull();
  });

  it("says a year past coverage has no data, not no spending", async () => {
    // `perimeter` stays POPULATED: the real route always returns it, and the
    // first version of this fixture nulled it — which hid a live defect where
    // the amber box rendered with a blank in place of €41bn.
    payload = { ...FY2024, rows: [], totalEur: null };
    renderIt("?fy=2026");
    const line = await screen.findByText(/няма разбивка по функция/);
    // Asserted on the SENTENCE, not on the page: „2024" also appears on a year
    // chip, so a body-wide check passed with the whole coverage clause deleted.
    expect(line.textContent).toMatch(/стигат до 2024/);
  });

  it("offers no basis the year cannot answer", async () => {
    // `population` is NULL on every row, so „на човек" resolved to null for all
    // ten divisions in all fifteen years — ten em dashes with live percentages
    // and bars beside them, because `rows.length` is still 10 and the empty
    // branch never fires.
    renderIt();
    await screen.findByText(dict.cofog_GF10);
    const labels = [...document.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(labels).not.toContain("на човек");
    // …and GDP is offered on 2024, which has a GDP.
    expect(labels).toContain(dict.budget_basis_gdp);
  });

  it("hides the GDP basis on a year with no GDP", async () => {
    // `budget_fiscal_year` starts in 2021; COFOG starts in 2010.
    payload = { ...FY2024, fiscalYear: 2015 };
    renderIt("?fy=2015");
    await screen.findByText(dict.cofog_GF10);
    const labels = [...document.querySelectorAll("button")].map(
      (b) => b.textContent,
    );
    expect(labels).not.toContain(dict.budget_basis_gdp);
  });

  it("ranks by share, whatever order the server sent", async () => {
    // `budget_cofog_list` orders by `amount DESC NULLS LAST`, which ties at null
    // and collapses into code order — „Общи държавни служби 7,5%" above
    // „Социална закрила 36,8%", both percentages correct.
    payload = {
      ...FY2024,
      rows: [
        { ...FY2024.rows[2], amount: null },
        { ...FY2024.rows[1], amount: null },
        { ...FY2024.rows[0], amount: null },
      ],
    };
    renderIt();
    await screen.findByText(dict.cofog_GF10);
    const first = document.querySelector("ul.divide-y > li")!;
    expect(first.textContent).toContain(dict.cofog_GF10);
  });

  it("warns that a function is not a ministry", async () => {
    renderIt();
    await screen.findByText(dict.cofog_GF07);
    const note = screen.getByText(dict.budget_func_not_ministries);
    expect(note.textContent).toMatch(/Министерството на здравеопазването/);
  });

  // ── T9.1 · the chart ──────────────────────────────────────────────────────
  it("hands the chart every function, collapsing none", async () => {
    // The reason this page got a BAR chart rather than the composition donut:
    // the donut collapses its tail past seven slices, and on the real corpus
    // the bottom three are Жилищно строителство, Култура, отдих и религия and
    // на околната среда — 6.0% between them and three policy areas a reader may
    // have come specifically to find.
    //
    // Ten rows, so the collapse threshold is genuinely crossed: with seven the
    // assertion would pass under either shape.
    const codes = [
      "GF10",
      "GF04",
      "GF07",
      "GF09",
      "GF01",
      "GF03",
      "GF02",
      "GF06",
      "GF08",
      "GF05",
    ];
    payload = {
      ...FY2024,
      rows: codes.map((code, i) => ({
        code,
        nameBg: null,
        nameEn: null,
        amount: (10 - i) * 1_000_000_000,
        pctOfTotal: (10 - i) * 1.8,
      })),
    };
    renderIt();
    await screen.findByText(dict.cofog_GF10);
    // ⚠️ ASSERTED ON WHAT THE CHART RECEIVED, not on the page text: the <ul>
    // carries all ten labels whatever the chart was handed, so a page-text
    // assertion here cannot fail.
    expect(chartBars.map((b) => b.code)).toEqual(codes);
    // …and the labels are resolved, not raw COFOG codes.
    expect(chartBars[0].label).toBe(dict.cofog_GF10);
    // Every division is named on the page too, none folded into an „other".
    for (const code of codes) {
      expect(
        screen.queryAllByText(dict[`cofog_${code}`]).length,
        `${code} is missing from the page`,
      ).toBeGreaterThan(0);
    }
    expect(sp(document.body.textContent)).not.toContain("Други");
  });

  it("draws the chart, and draws it ABOVE the list", async () => {
    // Removing `<BudgetFunctionalChart>` leaves every other gate on this page
    // green — the <ul> still carries all ten labels and figures — so its
    // presence has to be asserted directly. And „above" is not decoration: the
    // chart is the shape, the list is the detail, and a chart under its own
    // table is a footnote.
    renderIt();
    await screen.findByText(dict.cofog_GF10);
    const chart = screen.getByTestId("functional-chart");
    const list = [...document.querySelectorAll("ul")].find((ul) =>
      (ul.textContent ?? "").includes(dict.cofog_GF10),
    )!;
    expect(
      chart.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("draws no peak-scaled bar beside the figures", async () => {
    // ⚠️ THE DEFECT THE CHART REPLACED. Each row carried a `<div>` whose width
    // was the share divided by the LARGEST share, so „Социална закрила" filled
    // its row at 36.8% and every other function was drawn as a fraction of it —
    // a ranking encoding on a page whose subject is how a total divides. The
    // chart above the list carries the shares against a fixed 0-100% axis.
    renderIt();
    await screen.findByText(dict.cofog_GF10);
    const list = [...document.querySelectorAll("ul")].find((ul) =>
      (ul.textContent ?? "").includes(dict.cofog_GF10),
    )!;
    expect(list.querySelector("[style*='width']")).toBeNull();
  });
});
