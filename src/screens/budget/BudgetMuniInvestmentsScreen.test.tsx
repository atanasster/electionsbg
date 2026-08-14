// Gates for /budget/municipal/investments (ИПОП).
//
// €2.98bn contracted against €0.99bn paid. Three failures:
//
//   * SHOWING THE CONTRACTED FIGURE ALONE. It reads as investment delivered.
//   * CALLING 769 PROJECTS ABANDONED. „Flagged" is a threshold — agreement
//     ≥ €100 000 and under 5% paid — over a snapshot with NO signing date, so a
//     contract signed last month is flagged exactly like one signed in 2022.
//   * PRINTING THE THRESHOLD FROM A CONSTANT. It travels in the payload, so the
//     page cannot describe a rule the server has stopped applying.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import bgDict from "@/locales/bg/translation.json";
import { BudgetMuniInvestmentsScreen } from "./BudgetMuniInvestmentsScreen";

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

/** Verbatim from `budget_muni_ipop(NULL, …)`. */
const PAYLOAD = {
  fiscalYear: 2025,
  stalledRule: { minAgreementEur: 100000, maxPaidPct: 5 },
  national: {
    projectCount: 3492,
    municipalityCount: 264,
    agreementEur: 2980578186.19,
    paidEur: 990923616.16,
    stalledCount: 769,
    stalledAgreementEur: 1154400831.67,
    stalledWithClaimCount: 306,
    stalledWithClaimEur: 343413633.58,
    cohorts: [
      {
        cohort: "24",
        projectCount: 2749,
        agreementEur: 2769772224.85,
        paidEur: 979312105.7,
        stalledCount: 678,
      },
      {
        cohort: "25",
        projectCount: 743,
        agreementEur: 210805961.34,
        paidEur: 11611510.46,
        stalledCount: 91,
      },
    ],
  },
  rows: [
    {
      obshtina: "VAR06",
      nameBg: "Варна",
      nameEn: "Varna",
      projectCount: 47,
      agreementEur: 92882295.49,
      paidEur: 9943470.11,
      paidPct: 10.705452591953376,
      stalledCount: 21,
    },
    {
      obshtina: "PER36",
      nameBg: "Трекляно",
      nameEn: "Treklyano",
      projectCount: 2,
      agreementEur: 500000,
      paidEur: 500000,
      paidPct: 100,
      stalledCount: 0,
    },
    {
      obshtina: "KNL01",
      nameBg: "Бойница",
      nameEn: "Boynitsa",
      projectCount: 1,
      agreementEur: 200000,
      paidEur: 2000,
      paidPct: 1,
      stalledCount: 1,
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

const renderIt = (search = "") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/budget/municipal/investments${search}`]}>
        <BudgetMuniInvestmentsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("BudgetMuniInvestmentsScreen", () => {
  it("never shows the contracted total without the paid one", async () => {
    renderIt();
    await screen.findByText(dict.budget_ipop_agreed);
    const body = nb(document.body.textContent);
    expect(body).toContain("€2 980 578 186");
    expect(body).toContain("€990 923 616");
    // …and the share, so the gap is stated rather than left to arithmetic.
    expect(body).toContain("33.2%");
  });

  it("prints the flag's rule from the payload, not from a constant", async () => {
    // Hard-coding €100 000 / 5% passed the earlier version of this gate — the
    // exact regression its own header named. The fixture now carries a
    // DIFFERENT rule, which only a payload-driven render can reproduce.
    payload = {
      ...PAYLOAD,
      stalledRule: { minAgreementEur: 250000, maxPaidPct: 12 },
    };
    renderIt();
    const rule = await screen.findByText(/праг, а не оценка/);
    expect(nb(rule.textContent)).toContain("€250 000");
    expect(rule.textContent).toContain("12%");
    expect(nb(rule.textContent)).not.toContain("€100 000");
  });

  it("qualifies the flag with the cohort and the claims already filed", async () => {
    renderIt();
    await screen.findByText(dict.budget_ipop_flagged);
    const body = nb(document.body.textContent);
    // 306 of 769 already have money submitted or awaiting settlement…
    expect(body).toContain("306");
    expect(body).toContain("€343 413 634");
    // …and OP-25 is young, not stalled: 5.5% against OP-24's 35.4%.
    expect(body).toContain("35.4%");
    expect(body).toContain("5.5%");
  });

  it("never calls a flagged project abandoned", async () => {
    renderIt();
    await screen.findByText(dict.budget_ipop_flagged);
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/изоставен|провален|неизпълнен|abandoned/i);
  });

  it("says what the flagged projects are worth, not just how many", async () => {
    renderIt();
    await screen.findByText(dict.budget_ipop_flagged);
    const body = nb(document.body.textContent);
    expect(body).toContain("769");
    // 769 projects means nothing without the money behind them.
    expect(body).toContain("€1 154 400 832");
  });

  it("shows each row's paid share, in server order", async () => {
    // The server ORDERs BY agreement; the component does not re-sort, so this
    // gate deliberately does NOT claim to test ranking — the earlier name did
    // and passed only because the fixture was pre-sorted.
    renderIt();
    await screen.findByText("Варна");
    const items = [...document.querySelectorAll("ul.divide-y > li")];
    expect(items[0].textContent).toContain("Варна");
    expect(items[0].textContent).toContain("10.7%");
    // A fully-paid municipality reads as such rather than as missing data.
    expect(items[1].textContent).toContain("100.0%");
  });

  it("sends the ACTUAL search term, not merely some q", async () => {
    // `toContain("q=")` is a two-character substring — a hook hard-coding
    // `q=zzz` satisfied it.
    renderIt("?q=Варна");
    await waitFor(() => {
      const urls = (
        globalThis.fetch as ReturnType<typeof vi.fn>
      ).mock.calls.map((c) => String(c[0]));
      expect(urls.length).toBeGreaterThan(0);
      expect(decodeURIComponent(urls[urls.length - 1])).toContain("q=Варна");
    });
  });

  it("hides the national cards while the list is filtered", async () => {
    // Three national figures above a one-row list read as that municipality's,
    // and two of the three carry no scope wording.
    renderIt("?q=Варна");
    await screen.findByText("Варна");
    expect(screen.queryByText(dict.budget_ipop_agreed)).toBeNull();
  });

  it("agrees in Bulgarian for a one-project municipality", async () => {
    renderIt();
    const row = (await screen.findByText("Бойница")).closest("li")!;
    expect(row.textContent).toContain("1 обект");
    expect(row.textContent).not.toContain("1 обекта");
    expect(row.textContent).toContain("1 отбелязан");
    expect(row.textContent).not.toContain("1 отбелязани");
  });

  it("says nothing rather than zero when the route degrades", async () => {
    payload = { error: "unknown /api/db endpoint" };
    renderIt();
    // „Няма намерени общини" is a claim about the CORPUS; a degraded route has
    // told us nothing about it.
    await waitFor(() =>
      expect(screen.getByText(dict.budget_ipop_unavailable)).toBeTruthy(),
    );
    expect(screen.queryByText(dict.budget_ipop_empty)).toBeNull();
    // No headline cards built from an absent payload.
    expect(screen.queryByText(dict.budget_ipop_agreed)).toBeNull();
    expect(screen.queryByText(/праг, а не оценка/)).toBeNull();
  });
});
