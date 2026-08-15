// Gates for the national municipal-commitments line on /budget (plan §8.4).
//
// One line, and three ways it goes wrong — each of which produces a sentence
// that reads perfectly and is false:
//
//   * SUMMED WITH THE STATE. Municipal commitments are a different debtor with
//     a different mandate; added to the state balance they make a number
//     nobody owes. No row count would show it.
//   * ZERO INSTEAD OF ABSENT. МФ freezes the commitments column some quarters
//     and the ingest withholds it; „€0 поети ангажименти" is the healthiest
//     figure in the country and completely false.
//   * A NATIONAL TOTAL OVER A PARTIAL ROSTER — a smaller number pretending to
//     be a complete one.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import bgDict from "@/locales/bg/translation.json";
import { BudgetHubScreen } from "./BudgetHubScreen";
import { showsMunicipalCommitments } from "./budgetHubMunicipal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "bg" },
    t: (k: string, o?: Record<string, unknown>) => {
      const raw = (bgDict as Record<string, string>)[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

const nb = (v: string | null) => (v ?? "").replace(/\u00a0/g, " ");

/** Verbatim from `budget_hub_stats(NULL)`. */
const MC = {
  fiscalYear: 2025,
  quarter: 2,
  commitmentsEur: 4162558194.485205,
  arrearsEur: 77367050.30600818,
  filedCount: 265,
  municipalityCount: 265,
};

let payload: Record<string, unknown> = {
  fiscalYear: 2026,
  complete: false,
  latestKfpPeriod: "2026-06",
  balanceExecutedEur: -1914405872,
  municipalCommitments: MC,
  cofogShares: [{ code: "GF10", pct: 100 }],
};

beforeEach(() => {
  payload = {
    fiscalYear: 2026,
    complete: false,
    latestKfpPeriod: "2026-06",
    balanceExecutedEur: -1914405872,
    municipalCommitments: MC,
    cofogShares: [{ code: "GF10", pct: 100 }],
  };
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
      <MemoryRouter initialEntries={["/budget"]}>
        <BudgetHubScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("showsMunicipalCommitments", () => {
  it("is false for a database that never ran migration 149", () => {
    expect(showsMunicipalCommitments(null)).toBe(false);
    expect(showsMunicipalCommitments(undefined)).toBe(false);
  });

  it("is false for a quarter that suppressed the column", () => {
    // 2025 Q3: every other column filed, `commitments` in `suppressed_fields`.
    expect(showsMunicipalCommitments({ commitmentsEur: null })).toBe(false);
  });

  it("is true only with an actual figure", () => {
    expect(showsMunicipalCommitments({ commitmentsEur: 4162558194 })).toBe(
      true,
    );
    // …including a genuine zero, which is a filed figure rather than a hole.
    expect(showsMunicipalCommitments({ commitmentsEur: 0 })).toBe(true);
  });
});

describe("the national municipal-commitments line", () => {
  it("names the quarter the figure actually comes from", async () => {
    renderIt();
    const line = await screen.findByText(/поети ангажименти/);
    expect(nb(line.textContent)).toContain("€4,2 млрд.");
    // 2025 Q2 — NOT the hub's own 2026, and not the latest quarter, which
    // suppresses the column.
    expect(line.textContent).toContain("2025");
    expect(line.textContent).toContain("тримесечие 2");
  });

  it("says the two figures do not add up", async () => {
    renderIt();
    const line = await screen.findByText(/поети ангажименти/);
    expect(line.textContent).toMatch(/не се събират/);
    expect(line.textContent).toMatch(/а не на държавата/);
    // …and „ангажименти" are NOT „дълг": `municipal_fiscal` carries
    // `debt_stock_eur` separately, and calling them debt is the one word this
    // sentence must not use.
    expect(line.textContent).toMatch(/различно нещо от общинския дълг/);
    expect(line.textContent).not.toMatch(/Това е дълг/);
    // …and the sum itself appears nowhere. −1 914 405 872 + 4 162 558 194
    // = 2 248 152 322, a number nobody owes.
    expect(nb(document.body.textContent)).not.toContain("2,2 млрд.");
  });

  it("renders NO line rather than a zero when the corpus is absent", async () => {
    // `budget_muni_commitments_national()` returns NULL on a database that has
    // never run migration 149 — a different loader entirely.
    payload = { ...payload, municipalCommitments: null };
    renderIt();
    // Anchored on a TILE — a unique, data-driven element that only exists once
    // the hub has rendered. „бюджет" matches a dozen nodes and throws.
    // Anchored on a STATS-DERIVED node. The tiles come from the static
    // `BUDGET_BANDS` and render on the first synchronous pass, so anchoring on
    // one let both absence assertions run BEFORE the stat call settled — they
    // passed verbatim against a payload whose line DOES render. The balance
    // metric exists only once `budget-hub-stats` has resolved.
    await waitFor(() =>
      // getAll: InfographicTile renders the metric twice — a desktop overlay
      // and a mobile row.
      expect(screen.getAllByText(/−€1,9 млрд\./).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/поети ангажименти/)).toBeNull();
    // The whole sentence, not „€0": `formatEurCompact(null)` returns the empty
    // string, so a „€0" check could never fire. What a broken guard actually
    // produces is this sentence with a BLANK where the amount goes.
    expect(document.body.textContent).not.toMatch(
      /Отделно от държавния бюджет/,
    );
  });

  it("renders no line when the quarter suppressed the column", async () => {
    // 2025 Q3 filed on every other column and reports `commitments` in
    // `suppressed_fields`. A national total of null must not become €0.
    payload = {
      ...payload,
      municipalCommitments: { ...MC, commitmentsEur: null },
    };
    renderIt();
    // Anchored on a STATS-DERIVED node. The tiles come from the static
    // `BUDGET_BANDS` and render on the first synchronous pass, so anchoring on
    // one let both absence assertions run BEFORE the stat call settled — they
    // passed verbatim against a payload whose line DOES render. The balance
    // metric exists only once `budget-hub-stats` has resolved.
    await waitFor(() =>
      // getAll: InfographicTile renders the metric twice — a desktop overlay
      // and a mobile row.
      expect(screen.getAllByText(/−€1,9 млрд\./).length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/поети ангажименти/)).toBeNull();
    expect(document.body.textContent).not.toMatch(
      /Отделно от държавния бюджет/,
    );
  });

  it("declares a partial roster", async () => {
    payload = {
      ...payload,
      municipalCommitments: { ...MC, filedCount: 240 },
    };
    renderIt();
    const line = await screen.findByText(/поети ангажименти/);
    expect(line.textContent).toMatch(/само 240 от 265/);
  });

  it("does not declare a roster that is complete", async () => {
    renderIt();
    await screen.findByText(/поети ангажименти/);
    expect(document.body.textContent).not.toMatch(/само 265 от 265/);
  });

  it("links to the place dashboard rather than reproducing it", async () => {
    renderIt();
    await screen.findByText(/поети ангажименти/);
    const link = screen.getByText(
      (bgDict as Record<string, string>).budget_hub_muni_link,
    );
    // „one map, one home" — the choropleth lives on /governance, not here.
    expect(link.closest("a")?.getAttribute("href")).toBe(
      "/governance/municipal-finance",
    );
  });
});
