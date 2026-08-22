// Gates for the EU-contribution figure on /budget (plan T9.5).
//
// It is one of the four figures the pre-migration screen led with, and the only
// one the migration left on NO hub surface — revenue, expenditure and the
// balance all became tile metrics, and this one owns no page so it could own no
// tile. It is a standalone line instead.
//
// ⚠️ IT WAS A TILE SECONDARY FIRST, and that placement failed the step's own
// purpose: `InfographicTile` renders `metricSecondary` inside a `hidden …
// sm:flex` cluster and its mobile arm carries `metric` + `metricCaption` only,
// so below 640px the figure was back on no surface at all. Every test here
// passed at every viewport, because jsdom applies no CSS — which is why the
// last gate asserts on the ELEMENT and its classes, not just on the text.
//
// THREE WAYS THIS GOES WRONG, and all of them read perfectly:
//
//   * IT IS NOT PART OF EXPENDITURE. Section III is its own term of
//     revenue − expenditure − EU contribution = balance. A secondary line that
//     reads as a component of the number above it restates §II as a figure the
//     Ministry publishes nowhere — the identical error
//     BudgetExecutionScreen.test.tsx's first gate exists to catch, one page up.
//   * ABSENT MUST NOT RENDER AS ZERO. A year too early to have filed §III, or a
//     database without the column, has no contribution to report — and
//     „€0 вноска в бюджета на ЕС" is a claim Bulgaria stopped paying.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bgCorpus as bgDict, enCorpus as enDict } from "@/locales/allKeys";
import { BudgetHubScreen } from "./BudgetHubScreen";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: lang },
    t: (k: string, o?: Record<string, unknown>) => {
      const dict = (lang === "bg" ? bgDict : enDict) as Record<string, string>;
      const raw = dict[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

const nb = (v: string | null) => (v ?? "").replace(/\u00a0/g, " ");

/** Verbatim from `budget_hub_stats(NULL)` on 2026-08-14. */
const BASE = {
  fiscalYear: 2026,
  complete: false,
  latestKfpPeriod: "2026-06",
  revenueExecutedEur: 12796331646,
  expenditureExecutedEur: 14150474073,
  euContributionExecutedEur: 560263445,
  balanceExecutedEur: -1914405872,
  balanceProjectedEur: -3405447950,
  cofogShares: [{ code: "GF10", pct: 100 }],
};

let payload: Record<string, unknown> = { ...BASE };

beforeEach(() => {
  lang = "bg";
  payload = { ...BASE };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => payload })),
  );
});

const renderHub = () =>
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

/** The spending tile's own metric, which is what the EU line must sit under
 *  and must never be folded into. Anchoring absence assertions on this proves
 *  the stat call settled — the tile grid itself renders synchronously from the
 *  static registry on the first pass, so anchoring on a tile TITLE would run
 *  every assertion below before any data arrived. */
const spendingMetric = () => screen.findAllByText(/€14,2 млрд\./);

/** The line itself. Matched on the <p>, so a test cannot be satisfied by an
 *  ancestor that merely contains the words. */
const euLine = () =>
  [...document.querySelectorAll("p")].find((el) =>
    (el.textContent ?? "").includes("вноската на България в бюджета на ЕС"),
  ) ?? null;

describe("the EU contribution on /budget", () => {
  it("renders beside expenditure and says it is a separate line", async () => {
    renderHub();
    await spendingMetric();
    const body = nb(document.body.textContent);
    expect(body).toContain("€560,3 млн.");
    // The line must name the PERIMETER it sits outside — „separately" on its
    // own never says separately from what.
    expect(body).toContain("Извън разходите на държавния бюджет");
    expect(body).toContain("не се събира с разходите");
    expect(euLine(), "the EU contribution is not its own element").toBeTruthy();
  });

  it("does not add the contribution into the expenditure figure", async () => {
    renderHub();
    await spendingMetric();
    const body = nb(document.body.textContent);
    // 14 150 474 073 + 560 263 445 = 14 710 737 518 → „€14,7 млрд." is what a
    // folded figure renders as, and it is the number the old Sankey's spending
    // side printed. It must not appear.
    expect(body).not.toContain("€14,7 млрд.");
    expect(body).toContain("€14,2 млрд.");
  });

  it("omits the line when the corpus has no contribution figure", async () => {
    payload = { ...BASE, euContributionExecutedEur: null };
    renderHub();
    await spendingMetric();
    const body = nb(document.body.textContent);
    expect(euLine(), "rendered a line with no figure").toBeNull();
    // …and specifically not as a zero. `formatEurCompact(null)` returns the
    // empty string, so a broken guard renders the sentence with a BLANK where
    // the amount goes rather than „€0" — which is what this catches.
    expect(body).not.toContain("вноската на България");
  });

  it("formats the amount in the reader's locale", async () => {
    // The hub already shipped one locale bug of exactly this shape: money
    // formatted bg-BG on /en, so „€12,8 млрд." appeared beside English counts.
    //
    // ⚠️ THE COMPACT SUFFIX MAY NOT BE PINNED — it is CLDR-versioned. This hub
    // formats `en-GB`, and CLDR 47 flipped that locale's compact suffixes from
    // „k/m/bn" to „K/M/B": the same figure renders „€14.2bn" on the ICU in CI's
    // Node 22 and „€14.2B" on the ICU 77 a current macOS ships. Pinning „€14.2B"
    // made this a gate on the runtime's CLDR — green locally, red on CI. The
    // DECIMAL MARK is what carries the locale (bg-BG: „€14,2 млрд."), so pin
    // that and leave the suffix to the runtime. Same reasoning in
    // BudgetPersonnelScreen.test.tsx.
    lang = "en";
    renderHub();
    await screen.findAllByText(/€14\.2\s?b/i);
    const body = nb(document.body.textContent);
    expect(body).toMatch(/€560\.3\s?[Mm]/);
    expect(body).toContain("Outside state budget expenditure");
    expect(body).not.toContain("млн.");
  });
  it("renders at every viewport, not only at sm and up", async () => {
    // The defect this gate exists for: as a tile `metricSecondary` the figure
    // sat in a `hidden … sm:flex` cluster whose mobile twin has no secondary
    // arm, so it vanished below 640px — with every text assertion above still
    // green, because jsdom applies no CSS. Assert on the CLASSES of the line
    // and its ancestors instead.
    renderHub();
    await spendingMetric();
    const line = euLine();
    expect(line).toBeTruthy();
    for (let el: HTMLElement | null = line; el; el = el.parentElement) {
      expect(
        el.className,
        `"${el.className}" hides the EU contribution below sm`,
      ).not.toMatch(/(^|\s)hidden(\s|$)/);
      if (el.tagName === "BODY") break;
    }
  });
});
