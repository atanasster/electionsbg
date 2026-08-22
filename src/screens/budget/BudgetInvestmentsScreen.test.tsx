// Gates for /budget/investments.
//
// The corpus is Приложение III to the budget act — an APPROPRIATION list. Three
// ways a page over-claims on it, all of which look like ordinary reporting:
//
//   * CALLING IT SPENDING. Nothing here says a project was built, started or
//     paid. There is no execution side to this source at all.
//   * SUMMING THE LEADERBOARD. `topProjects` is 50 of 3 065 and covers a
//     fraction of the money; presented as „the projects" it invites exactly
//     that.
//   * OFFERING A YEAR THE PROGRAMME DOES NOT HAVE. It exists for 2025 alone
//     while the module reaches 2026.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bgCorpus as bgDict } from "@/locales/allKeys";
import { BudgetInvestmentsScreen } from "./BudgetInvestmentsScreen";

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

const eur = (amountEur: number) => ({
  amount: Math.round(amountEur * 1.95583),
  currency: "BGN",
  amountEur,
});

const INDEX = {
  generatedAt: "2026-05-28T08:37:25.182Z",
  years: [{ fiscalYear: 2025, projectCount: 3065, grandTotalEur: 3612301325 }],
};

const PROGRAM = {
  fiscalYear: 2025,
  generatedAt: "2026-05-28T08:37:25.182Z",
  source: {
    documentId: "investment-program-2025",
    url: "https://dv.parliament.bg/DVPics/2025/26_25/1619.pdf",
  },
  projectCount: 3065,
  grandTotal: eur(3612301325),
  byOblast: [
    {
      key: "PDV",
      labelBg: "Пловдив",
      labelEn: "Plovdiv",
      count: 132,
      total: eur(359448674),
    },
    {
      key: "SFO",
      labelBg: "София",
      labelEn: "Sofia",
      count: 88,
      total: eur(500000000),
    },
    // The builder's sentinel, verbatim as it appears in the artifact.
    {
      key: "_unresolved",
      labelBg: "",
      labelEn: "",
      count: 91,
      total: eur(113300000),
    },
    // A real oblast whose Bulgarian label is the EMPTY STRING. This is the only
    // shape that reaches the `||` fallback — `_unresolved` is intercepted above
    // it — so without this row the fallback branch is untested and `??` passes.
    {
      key: "VAR",
      labelBg: "",
      labelEn: "Varna",
      count: 40,
      total: eur(90000000),
    },
  ],
  byCategory: [
    {
      key: "roads",
      labelBg: "Пътища и улици",
      labelEn: "Roads & streets",
      count: 1060,
      total: eur(1262694000),
    },
    {
      key: "education",
      labelBg: "Образование",
      labelEn: "Education",
      count: 300,
      total: eur(200000000),
    },
  ],
  topProjects: [
    {
      projectId: "OP-24.001-2724",
      name: "Нова учебна база на математическа гимназия",
      category: "education",
      municipalityNameBg: "Варна",
      ekatte: null,
      obshtinaCode: null,
      oblastCode: "VAR",
      oblastNameBg: "Варна",
      cost: eur(12000000),
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes("index.json") ? INDEX : PROGRAM),
    })),
  );
});

const renderIt = (search = "") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/budget/investments${search}`]}>
        <BudgetInvestmentsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("BudgetInvestmentsScreen", () => {
  it("says this is a plan, not spending, before any figure", async () => {
    renderIt();
    const warn = await screen.findByText(dict.budget_inv_plan_warning);
    expect(warn.textContent).toMatch(/ПЛАН, а не отчет/);
    // Above the headline, not a footnote under it.
    const headline = await screen.findByText(/Одобрено за 2025/);
    expect(
      warn.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("labels the top list as a leaderboard, with both counts", async () => {
    renderIt();
    const h = await screen.findByText(/Най-големите 1 обекта от 3065/);
    expect(h).toBeTruthy();
    // …and says the rows do not sum to the total.
    expect(screen.getByText(dict.budget_inv_top_note).textContent).toMatch(
      /класация, а не целият списък/,
    );
  });

  it("never offers a year the programme does not have", async () => {
    // The index carries 2025 only; the budget module reaches 2026.
    renderIt("?fy=2026");
    await screen.findByText(/Одобрено за 2025/);
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("investment_program/") && !u.includes("index"));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[urls.length - 1]).toContain("2025.json");
    expect(urls.join("|")).not.toContain("2026.json");
  });

  it("ranks by amount and shares against the WHOLE programme", async () => {
    renderIt();
    await screen.findByText("Пътища и улици");
    const items = [...document.querySelectorAll("ul.divide-y > li")];
    // The fixture lists roads first ALREADY, so this line cannot detect a
    // broken sort — the oblast case below does that, where the fixture is
    // deliberately out of order. Kept only to anchor the row being measured.
    expect(items[0].textContent).toContain("Пътища и улици");
    // 1 262 694 000 / 3 612 301 325 = 35.0% of the PROGRAMME, not 86.3% of the
    // two rows shown.
    expect(items[0].textContent ?? "").toContain("35.0%");
    expect(items[0].textContent ?? "").not.toContain("86.3%");
  });

  it("switches dimension without losing the year", async () => {
    renderIt("?fy=2025&dim=oblast");
    await screen.findByText("София");
    const items = [...document.querySelectorAll("ul.divide-y > li")];
    // Sofia (€500m) outranks Plovdiv (€359m) even though the fixture lists
    // Plovdiv first — the server's order is not trusted.
    expect(items[0].textContent).toContain("София");
  });

  it("labels the builder's _unresolved sentinel instead of printing it", async () => {
    // 91 of 3 065 real projects land in this row — €113.3m, 15th of 29 — and it
    // was rendered verbatim to readers in both languages. It must be LABELLED,
    // never filtered: the rollup rows sum to grandTotal exactly, and only
    // because this row is among them.
    renderIt("?dim=oblast");
    await screen.findByText("София");
    const body = document.body.textContent ?? "";
    expect(body).not.toContain("_unresolved");
    expect(screen.getByText(dict.budget_inv_unresolved)).toBeTruthy();
    // …and it is still counted, so the shares still sum against the whole.
    // The FIRST divide-y list is the rollup; the second is the top-projects
    // leaderboard, which would otherwise inflate this count.
    const rollup = document.querySelectorAll("ul.divide-y")[0];
    expect(rollup.querySelectorAll("li").length).toBe(4);
  });

  it("falls back on an empty label rather than rendering a blank row", async () => {
    // `??` sails past the empty string, leaving a row with an amount, a share
    // and no name. Only `||` reaches the other language.
    renderIt("?dim=oblast");
    await screen.findByText("София");
    expect(screen.getByText("Varna")).toBeTruthy();
  });

  it("shows a skeleton, not `no data`, before the index lands", async () => {
    // `fy` is undefined until index.json resolves, which disables the program
    // query — and React Query v5 then reports `isLoading: false`. The untouched
    // page announced „Няма данни" before it had asked for anything.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      ),
    );
    renderIt();
    await waitFor(() =>
      expect(document.querySelector(".animate-pulse")).toBeTruthy(),
    );
    expect(screen.queryByText(dict.budget_inv_empty)).toBeNull();
  });

  it("opens the source document safely", async () => {
    renderIt();
    const link = await screen.findByText(dict.budget_inv_source_link);
    const a = link.closest("a")!;
    expect(a.getAttribute("href")).toBe(PROGRAM.source.url);
    expect(a.getAttribute("rel")).toMatch(/noopener/);
  });
});
