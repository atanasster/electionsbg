// The one line that connects `budgetHubEvidence` to the page.
//
// The builder is thoroughly unit-tested and the SQL is gated by a data test; the
// `evidence={evidence}` prop between them was covered by nothing. Deleting it left the
// aside off the page with 337 unit tests, 11 data tests, `tsc -b` and ESLint all green —
// the „a gate that can no longer see its subject" shape, one level up from the file that
// warns about it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bgCorpus as bgDict } from "@/locales/allKeys";
import { BudgetHubScreen } from "./BudgetHubScreen";
import { BUDGET_STATS_FIXTURE } from "./budgetHubStats.fixture";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "bg" },
    t: (k: string, o?: Record<string, unknown>) => {
      const raw = (bgDict as Record<string, string>)[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

let payload: Record<string, unknown>;

beforeEach(() => {
  payload = { ...BUDGET_STATS_FIXTURE } as unknown as Record<string, unknown>;
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

describe("the /budget head's evidence aside", () => {
  it("is mounted, with each row linking to its own spending unit", async () => {
    renderIt();
    // The heading proves the aside reached the head; the link proves the rows did.
    expect(
      await screen.findByText(bgDict.budget_evidence_heading),
    ).toBeTruthy();
    const row = await screen.findByRole("link", {
      name: /Министерство на отбраната/,
    });
    expect(row.getAttribute("href")).toContain(
      "/budget/ministry/admin-ministerstvo-na-otbranata",
    );
    expect(
      screen.getByRole("link", { name: bgDict.budget_evidence_action }),
    ).toBeTruthy();
  });

  it("carries the denominator that stops the rows reading as a breakdown", async () => {
    // The five visible rows sum to ~€8,6 млрд. under a band cell saying €29,6 млрд. —
    // different perimeters (ЗДБРБ per-ПРБ vs the consolidated КФП). Without the caption
    // the aside reads as an arithmetic error in one of the two.
    renderIt();
    // ⚠ Anchored on „по утвърден бюджет", not on „първостепенни разпоредители" — the
    // ministries TILE's own description uses that phrase too, and `findByText` picked it
    // up instead, passing the aside's caption by while looking like it had found it.
    const basis = await screen.findByText(/по утвърден бюджет/);
    // `Intl` compact output uses a NON-BREAKING space before the unit.
    const text = basis.textContent!.replace(/\u00a0/g, " ");
    expect(text).toContain("44");
    expect(text).toMatch(/€13,3 млрд\./);
    expect(text).toMatch(/не е разбивка/i);
  });

  it("shows NO aside at all when the denominator is missing", async () => {
    // A partial database — rows present, totals absent. A fragment of an unstated whole
    // is the one thing this aside must never be, so the builder refuses outright.
    payload = {
      ...BUDGET_STATS_FIXTURE,
      adminTotalPlannedEur: null,
    } as unknown as Record<string, unknown>;
    renderIt();
    // The band still renders, so this is the aside being refused rather than a dead page.
    expect(await screen.findByText(bgDict.budget_kpi_expenditure)).toBeTruthy();
    expect(screen.queryByText(bgDict.budget_evidence_heading)).toBeNull();
  });
});
