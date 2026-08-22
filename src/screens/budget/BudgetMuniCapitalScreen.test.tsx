// Gates for /budget/municipal/capital.
//
// The corpus is a SAMPLE, not a return: 9 of 265 municipalities in 2022, 24 in
// 2025, ONE in 2026. Three failures follow:
//
//   * PRESENTING A SUM OVER 24 MUNICIPALITIES AS NATIONAL. „€833m of municipal
//     capital spending in 2025" from a 9% sample is the one claim this page
//     must never make.
//   * COMPUTING SHARES AGAINST THE PUBLISHED TOTAL. Some municipalities publish
//     a total without a full source breakdown, so the components sum to less;
//     dividing by the total under-states every one of them.
//   * READING A NULL SOURCE AS ZERO. Most municipalities publish no carry-over
//     column at all.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bgCorpus as bgDict } from "@/locales/allKeys";
import { BudgetMuniCapitalScreen } from "./BudgetMuniCapitalScreen";

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

/** Sofia 2025, verbatim from `budget_muni_capital(2025)`. */
const SOFIA = {
  obshtina: "SFO_CITY",
  nameBg: "Столична община",
  nameEn: "Sofia (capital municipality)",
  projectCount: 352,
  totalEur: 267759609,
  stateSubsidyEur: 12851168,
  ownFundsEur: 195362111,
  debtEur: null,
  euFundsEur: 59546334,
  otherEur: null,
  carryOverEur: null,
};

const ONE_PROJECT = {
  obshtina: "VID10",
  nameBg: "Бойница",
  nameEn: "Boynitsa",
  projectCount: 1,
  totalEur: 120000,
  stateSubsidyEur: null,
  ownFundsEur: 120000,
  debtEur: null,
  euFundsEur: null,
  otherEur: null,
  carryOverEur: null,
};

const PAYLOAD = {
  fiscalYear: 2025,
  yearsAvailable: [2022, 2023, 2024, 2025, 2026],
  totalMunicipalities: 265,
  covered: { municipalityCount: 24, projectCount: 6329, totalEur: 833100000 },
  // Deliberately sums to LESS than covered.totalEur — the real shape, because
  // some municipalities publish a total with no full breakdown.
  sources: {
    // The mix's OWN coverage — 2 of the 24, worth €354.4m of €833.1m.
    municipalityCount: 2,
    projectCount: 900,
    totalEur: 354400000,
    stateSubsidyEur: 15000000,
    ownFundsEur: 500000000,
    debtEur: null,
    euFundsEur: 94000000,
    otherEur: null,
    carryOverEur: null,
  },
  rows: [SOFIA, ONE_PROJECT],
};

let payload: unknown = PAYLOAD;

beforeEach(() => {
  payload = PAYLOAD;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => payload })),
  );
});

const renderIt = (search = "?fy=2025") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/budget/municipal/capital${search}`]}>
        <BudgetMuniCapitalScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("BudgetMuniCapitalScreen", () => {
  it("leads with the coverage and its denominator", async () => {
    renderIt();
    const note = await screen.findByText(/НЕ е национална справка/);
    expect(note.textContent).toMatch(/24 от 265/);
    expect(note.textContent).toMatch(/6329/);
    // Above the list, not a footnote under it.
    const list = document.querySelector("ul.divide-y")!;
    expect(
      note.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shares each source against the sources, not the published total", async () => {
    renderIt();
    await screen.findByText(dict.budget_cap_own);
    const own = screen.getByText(dict.budget_cap_own).closest("li")!;
    // 500m / 609m of PUBLISHED sources = 82.1%. Against covered.totalEur
    // (833.1m) it would be 60.0% — every component silently under-stated.
    expect(nb(own.textContent)).toContain("82.1%");
    expect(nb(own.textContent)).not.toContain("60.0%");
  });

  it("omits a source no municipality published, rather than showing €0", async () => {
    renderIt();
    await screen.findByText(dict.budget_cap_own);
    // `debtEur`, `otherEur` and `carryOverEur` are NULL across the set.
    expect(screen.queryByText(dict.budget_cap_debt)).toBeNull();
    expect(screen.queryByText(dict.budget_cap_carry)).toBeNull();
    expect(screen.getByText(dict.budget_cap_eu)).toBeTruthy();
  });

  it("offers this corpus's own years, from the payload", async () => {
    // A list that does NOT match the real corpus: hardcoding 2022-2026 left the
    // earlier version of this gate green, because the fixture agreed with it.
    payload = { ...PAYLOAD, yearsAvailable: [2019, 2031] };
    renderIt("?fy=2031");
    await screen.findByText(/Столична община/);
    const chips = [...document.querySelectorAll("button")]
      .map((b) => b.textContent)
      .filter((v) => /^\d{4}$/.test(v ?? ""));
    expect(chips).toEqual(["2019", "2031"]);
  });

  it("labels the funding mix with the mix's OWN coverage", async () => {
    // Only 2 of the 24 publish a breakdown. Labelled „за 24 общини" this panel
    // makes exactly the claim the page's coverage note forbids — on FY2023 it
    // would be Бургас alone, 7.1% of the money, above a list topped by
    // Столична, which contributes nothing to it.
    renderIt();
    const h = await screen.findByText(/Откъде идват парите/);
    expect(h.textContent).toMatch(/за 2 общини/);
    expect(h.textContent).not.toMatch(/за 24 общини/);
    // …and the note names both the count and the money it covers.
    const note = screen.getByText(/публикуват разбивка по източник/);
    expect(nb(note.textContent)).toContain("€354 400 000");
    expect(nb(note.textContent)).toContain("€833 100 000");
  });

  it("never renders a five-year total under a blank year", async () => {
    // `budget_muni_capital(NULL)` aggregates ACROSS ALL FIVE YEARS, and with no
    // in-app link yet the bare URL was the only entry point. A year is always
    // chosen — the newest the corpus has.
    renderIt("");
    await screen.findByText(/Столична община/);
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .filter(
        (u) => u.includes("budget-municipal-capital") && u.includes("fy="),
      );
    expect(urls.length).toBeGreaterThan(0);
    expect(urls[urls.length - 1]).toContain("fy=2026");
    const note = screen.getByText(/НЕ е национална справка/);
    expect(note.textContent).not.toMatch(/За\s+г\./);
  });

  it("refuses a year the corpus does not have", async () => {
    // `?fy=1899` passed the four-digit test and was then dropped by the route's
    // own 1990-2100 clamp, stamping the five-year total with 1899.
    renderIt("?fy=1899");
    await screen.findByText(/Столична община/);
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("budget-municipal-capital"));
    expect(urls.join("|")).not.toContain("fy=1899");
  });

  it("qualifies every figure even without the national denominator", async () => {
    // `totalMunicipalities` comes from `obshtina_population` — migration 149,
    // a different loader. Gated on it, an empty table left every figure on this
    // page unqualified.
    payload = { ...PAYLOAD, totalMunicipalities: null };
    renderIt();
    const note = await screen.findByText(/НЕ е национална справка/);
    expect(note.textContent).toMatch(/24 общини/);
  });

  it("agrees in Bulgarian for a one-project municipality", async () => {
    renderIt();
    const row = (await screen.findByText("Бойница")).closest("li")!;
    expect(row.textContent).toContain("1 обект");
    expect(row.textContent).not.toContain("1 обекта");
  });

  it("says the data is unavailable, not that no list exists", async () => {
    payload = { error: "unknown /api/db endpoint" };
    renderIt();
    await waitFor(() =>
      expect(screen.getByText(dict.budget_cap_unavailable)).toBeTruthy(),
    );
    expect(screen.queryByText(dict.budget_cap_empty)).toBeNull();
    expect(screen.queryByText(/НЕ е национална справка/)).toBeNull();
  });
});
