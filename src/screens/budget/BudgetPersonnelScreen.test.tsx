// Gates for /budget/personnel.
//
// The whole page exists to keep two numbers apart. FY2025: 133 275 filled posts
// and 98 446 persons employed per НСИ — the SAME document, different
// methodologies, 34 829 apart. The failure this file prevents is arithmetic
// across them: „34 829 posts are paid for and empty" is a fabricated finding,
// and the real vacancy count (12 348) is published directly.
//
// Second: `payrollEur` is NULL on every row, so the page must show no money at
// all rather than €0.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import bgDict from "@/locales/bg/translation.json";
import { BudgetPersonnelScreen } from "./BudgetPersonnelScreen";

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
const sp = (v: string | null) => (v ?? "").replace(/\u00a0/g, " ");

/** Verbatim from `budget_personnel_series()`. */
const PAYLOAD = {
  positionsBasis: "Щатни бройки по Доклада за състоянието на администрацията",
  headcountBasis:
    "НСИ, наети лица (списъчен брой) към декември — отделна справка в същия доклад",
  points: [
    {
      fiscalYear: 2024,
      positionsTotal: 145802,
      positionsFilled: 132392,
      positionsVacant: 13410,
      nsiHeadcount: 98975,
      payrollEur: null,
    },
    {
      fiscalYear: 2025,
      positionsTotal: 145623,
      positionsFilled: 133275,
      positionsVacant: 12348,
      nsiHeadcount: 98446,
      payrollEur: null,
    },
  ],
};

let payload: unknown = PAYLOAD;

beforeEach(() => {
  payload = PAYLOAD;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => payload })),
  );
});

const renderIt = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/budget/personnel"]}>
        <BudgetPersonnelScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("BudgetPersonnelScreen", () => {
  it("never subtracts the NSI headcount from the filled posts", async () => {
    renderIt();
    await screen.findByText(dict.budget_staff_nsi_h);
    const body = sp(document.body.textContent);
    // 133 275 − 98 446 = 34 829. It is not „posts paid for and empty" and must
    // appear nowhere.
    expect(body).not.toContain("34 829");
    expect(body).not.toContain("34829");
  });

  it("takes the vacancy count from the source, not from the gap", async () => {
    renderIt();
    const line = await screen.findByText(/Незаетите са/);
    // 12 348 / 145 623 = 8.5%. Computed against the NSI figure it would be
    // 32.4% — a number four times too large, from two different populations.
    expect(line.textContent).toContain("8.5%");
    expect(line.textContent).not.toContain("32.4%");
    expect(sp(document.body.textContent)).toContain("12 348");
  });

  it("names the basis of each series where it is read", async () => {
    renderIt();
    await screen.findByText(dict.budget_staff_nsi_h);
    // Both come from the payload, so a change in the SQL cannot strand a
    // caption. Substring, not exact: the positions caption shares its paragraph
    // with the non-zero-axis note.
    // Query the <p> elements directly: an ancestor-matching text query hits
    // every wrapper up the tree.
    const captions = [...document.querySelectorAll("p")].map(
      (n) => n.textContent ?? "",
    );
    expect(captions.some((c) => c.includes(PAYLOAD.positionsBasis))).toBe(true);
    expect(captions.some((c) => c.includes(PAYLOAD.headcountBasis))).toBe(true);
    // …and the note gives the ACTUAL reason from the source's footnotes —
    // НСИ excludes МВР and МО and includes staff outside the establishment —
    // rather than „a different set", which is true and says nothing.
    const note = screen.getByText(dict.budget_staff_nsi_note);
    expect(note.textContent).toMatch(/МВР и МО/);
    expect(note.textContent).toMatch(/извън утвърдения щат/);
    expect(note.textContent).toMatch(/несъпоставими/);
  });

  it("shows no money at all, because the source publishes none", async () => {
    renderIt();
    await screen.findByText(dict.budget_staff_nsi_h);
    // `payrollEur` is NULL on every row. „€0" would assert the administration
    // costs nothing.
    expect(document.body.textContent).not.toContain("€");
  });

  it("uses the LATEST year for the headline, not the first", async () => {
    renderIt();
    const card = (await screen.findByText(dict.budget_staff_total)).closest(
      "div",
    )!;
    // Asserted on the CARD. Against the whole body this passed either way: the
    // trend list below renders EVERY year's total, so „145 623" is present even
    // when the headline shows 2024's.
    expect(sp(card.textContent)).toContain("145 623");
    expect(sp(card.textContent)).not.toContain("145 802");
    const filled = (await screen.findByText(dict.budget_staff_filled)).closest(
      "div",
    )!;
    expect(sp(filled.textContent)).toContain("133 275");
    const line = await screen.findByText(/Незаетите са/);
    expect(line.textContent).toContain("2025");
  });

  it("says nothing rather than zero when the route degrades", async () => {
    payload = { error: "unknown /api/db endpoint" };
    renderIt();
    await waitFor(() =>
      expect(screen.getByText(dict.budget_staff_empty)).toBeTruthy(),
    );
    expect(screen.queryByText(dict.budget_staff_total)).toBeNull();
    expect(screen.queryByText(/Незаетите са/)).toBeNull();
  });
});
