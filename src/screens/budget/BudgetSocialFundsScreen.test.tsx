// Gates for /budget/social-funds.
//
// ДОО collects €6.59bn and spends €12.59bn, and its balance is −€102m. Those
// three numbers are only reconcilable through the €5.89bn transfer in, and a
// page that omits it shows a €6bn hole beside a stated −€102m — from which a
// reader concludes one figure is wrong.
//
//     6 590 528 454 − 12 585 473 587 + 5 892 736 120 − 0 = −102 209 013
//
// Second: a year carries per-fund detail only once НОИ publishes the B1 sheets.
// The mid-cycle shell has no `funds`, and offering it renders an empty table
// under a year heading — „the funds reported nothing".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import bgDict from "@/locales/bg/translation.json";
import { BudgetSocialFundsScreen } from "./BudgetSocialFundsScreen";

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
const nb = (v: string | null) => (v ?? "").replace(/\u00a0/g, " ");
const m = (amountEur: number) => ({
  amount: Math.round(amountEur * 1.95583),
  currency: "BGN",
  amountEur,
});

/** ДОО 2024, verbatim from `data/budget/noi/funds.json`. */
const DOO = {
  fundCode: "5500",
  fundLabelBg: "Държавно обществено осигуряване",
  fundLabelEn: "State social security",
  fiscalYear: 2024,
  asOf: "2024-12-31",
  revenue: m(6590528454),
  expenditure: m(12585473587),
  balance: m(-102209013),
  transfers: m(5892736120),
  transfersCentralBudget: m(5891263018),
  euContribution: m(0),
  taxRevenue: m(6480099521),
};

const TEACHERS = {
  ...DOO,
  fundCode: "5591",
  fundLabelBg: "Учителски пенсионен фонд",
  fundLabelEn: "Teachers' pension fund",
  revenue: m(68700085),
  expenditure: m(52504359),
  balance: m(16195726),
  transfers: m(0),
  transfersCentralBudget: m(0),
};

const FILE = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  source: { publisher: "НОИ", urlTemplate: "", description: "" },
  years: [
    // The mid-cycle shell: no per-fund detail at all.
    { fiscalYear: 2023, asOf: "2023-12-31", funds: [] },
    // A second DETAILED year, so the picker renders and `?fy` is exercised.
    // With one year `years.length > 1` is false and the whole control — plus
    // every `?fy` path — was uncovered.
    {
      fiscalYear: 2022,
      asOf: "2022-12-31",
      funds: [{ ...DOO, fiscalYear: 2022, revenue: m(6000000000) }],
    },
    { fiscalYear: 2024, asOf: "2024-12-31", funds: [DOO, TEACHERS] },
  ],
};

let payload: unknown = FILE;

beforeEach(() => {
  payload = FILE;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => payload })),
  );
});

const renderIt = (search = "") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/budget/social-funds${search}`]}>
        <BudgetSocialFundsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("BudgetSocialFundsScreen", () => {
  it("shows the transfer, so the balance is reconcilable", async () => {
    renderIt();
    const card = (
      await screen.findByText("Държавно обществено осигуряване")
    ).closest("div")!;
    const txt = nb(card.textContent);
    // All four terms, and the balance they produce.
    expect(txt).toContain("€6 590 528 454");
    expect(txt).toContain("€12 585 473 587");
    expect(txt).toContain("€5 892 736 120");
    expect(txt).toContain("−€102 209 013");
    // Without the transfer a reader would compute −€5 994 945 133.
    expect(txt).not.toContain("5 994 945 133");
  });

  it("claims the identity only when the terms produce the balance", async () => {
    renderIt();
    await screen.findByText("Държавно обществено осигуряване");
    expect(screen.getAllByText(dict.budget_funds_identity).length).toBe(2);
    expect(screen.queryByText(dict.budget_funds_identity_broken)).toBeNull();
  });

  it("refuses the identity when a term is inconsistent", async () => {
    payload = {
      ...FILE,
      years: [
        FILE.years[0],
        {
          ...FILE.years[1],
          funds: [{ ...DOO, transfers: m(4000000000) }],
        },
      ],
    };
    renderIt();
    await screen.findByText("Държавно обществено осигуряване");
    expect(screen.getByText(dict.budget_funds_identity_broken)).toBeTruthy();
    expect(screen.queryByText(dict.budget_funds_identity)).toBeNull();
  });

  it("states the self-funded share against the fund's OWN spending", async () => {
    renderIt();
    const line = await screen.findByText(/Собствените приходи покриват 52\.4%/);
    // 6 590 528 454 / 12 585 473 587 = 52.4%. Against revenue+transfers it
    // would be 52.8%, and against the balance it would be meaningless.
    expect(line).toBeTruthy();
  });

  it("names the central-budget transfer and links to the other side", async () => {
    renderIt();
    const line = await screen.findByText(/идват от централния бюджет/);
    expect(nb(line.textContent)).toContain("€5 891 263 018");
    const link = screen.getByText(dict.budget_funds_see_spending);
    // With the year: the default is 2024 here, and /budget/spending's own
    // default is 2026, so a bare link lands on a different year's line.
    expect(link.closest("a")?.getAttribute("href")).toBe(
      "/budget/spending?fy=2024",
    );
  });

  it("offers only the years that carry per-fund detail", async () => {
    renderIt();
    await screen.findByText("Държавно обществено осигуряване");
    const chips = [...document.querySelectorAll("button")]
      .map((b) => b.textContent)
      .filter((v) => /^\d{4}$/.test(v ?? ""));
    // 2023 is a yearbook-only shell — offering it renders an empty table under
    // a year heading, which reads as „the funds reported nothing".
    expect(chips).not.toContain("2023");
  });

  it("reads ?fy and carries it into the cross-link", async () => {
    renderIt("?fy=2022");
    await screen.findByText("Държавно обществено осигуряване");
    // The 2022 fixture'"'"'s revenue, not 2024'"'"'s.
    expect(nb(document.body.textContent)).toContain("€6 000 000 000");
    // …and the link to the other side of the transfer carries the year, or the
    // reader lands on a different year'"'"'s figure.
    const link = screen.getByText(dict.budget_funds_see_spending);
    expect(link.closest("a")?.getAttribute("href")).toBe(
      "/budget/spending?fy=2022",
    );
  });

  it("says a MISSING term is missing, and does not blame НОИ", async () => {
    // `transfers` absent is a normal bucket-serving state — funds.json written
    // before those columns were parsed. Rendered through a two-way ternary it
    // read as „НОИ'"'"'s published lines disagree", which is an accusation.
    payload = {
      ...FILE,
      years: [
        FILE.years[0],
        FILE.years[1],
        {
          ...FILE.years[2],
          funds: [{ ...DOO, transfers: undefined }],
        },
      ],
    };
    renderIt();
    await screen.findByText("Държавно обществено осигуряване");
    expect(screen.getByText(dict.budget_funds_identity_missing)).toBeTruthy();
    expect(screen.queryByText(dict.budget_funds_identity_broken)).toBeNull();
  });

  it("does not tell a self-funding fund its revenue falls short", async () => {
    // Учителски is 130.8% and ГВРС 133.5%. One sentence cannot serve both
    // directions, and the intro no longer generalises either.
    renderIt();
    const line = await screen.findByText(
      /Собствените приходи покриват 130\.8%/,
    );
    expect(line.textContent).toMatch(/издържа сам/);
    // ДОО still gets the shortfall wording.
    expect(
      screen.getByText(/Собствените приходи покриват 52\.4%/).textContent,
    ).not.toMatch(/издържа сам/);
  });

  it("holds the identity tolerance tight enough to matter", async () => {
    // €1 000 was never exercised: every fixture closed exactly, so Infinity,
    // 1 and a bare `true` all left the suite green. ГВРС closes to €1 in the
    // real file, so the tolerance must accept 1 and reject a real break.
    payload = {
      ...FILE,
      years: [
        FILE.years[0],
        FILE.years[1],
        {
          ...FILE.years[2],
          funds: [
            { ...DOO, fundLabelBg: "Точен", balance: m(-102209012) },
            {
              ...TEACHERS,
              fundLabelBg: "Счупен",
              balance: m(16195726 + 50000),
            },
          ],
        },
      ],
    };
    renderIt();
    const ok = (await screen.findByText("Точен")).closest("div")!;
    const bad = screen.getByText("Счупен").closest("div")!;
    // 1 EUR off — accepted, as the real ГВРС row is.
    expect(ok.textContent).toContain(dict.budget_funds_identity);
    // €50 000 off — refused.
    expect(bad.textContent).toContain(dict.budget_funds_identity_broken);
  });

  it("ranks the funds by size, not by the order the file listed them", async () => {
    payload = {
      ...FILE,
      years: [FILE.years[0], { ...FILE.years[1], funds: [TEACHERS, DOO] }],
    };
    renderIt();
    await screen.findByText("Държавно обществено осигуряване");
    const headings = [...document.querySelectorAll("h2")].map(
      (h) => h.textContent,
    );
    expect(headings[0]).toBe("Държавно обществено осигуряване");
  });
});
