// Gates for the „Бюджети по кабинети" cross-link on /budget (plan T9.12).
//
// The pre-migration screen carried this card between its execution and
// composition sections. The hub dropped it, and that left /indicators/budgets
// with NO inbound link from the budget module at all — measured across the
// whole of src/ before this step. Every tile on the hub answers a question
// inside one fiscal year; this is the only destination that asks who ran them.
//
// TWO WAYS IT REGRESSES, and neither shows up as a broken page:
//
//   * IT SILENTLY DISAPPEARS AGAIN. A link nothing asserts is a link the next
//     layout change removes, which is exactly what happened the first time.
//   * IT DROPS THE ELECTION. /indicators/budgets is in the cabinet-anchor route
//     group and reads `?elections=`; a link that strips it answers for a
//     different parliament under the same heading. The card the hub replaces
//     forwarded the raw `search`, which is the opposite failure — it carried
//     whatever this page happened to be holding.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import bgDict from "@/locales/bg/translation.json";
import { BudgetHubScreen } from "./BudgetHubScreen";

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

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        fiscalYear: 2026,
        complete: false,
        latestKfpPeriod: "2026-06",
        expenditureExecutedEur: 14150474073,
        euContributionExecutedEur: 560263445,
        cofogShares: [{ code: "GF10", pct: 100 }],
      }),
    })),
  );
});

const renderHub = (entry = "/budget") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[entry]}>
        <BudgetHubScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const cabinetLink = (): HTMLAnchorElement | null =>
  [...document.querySelectorAll("a")].find((a) =>
    (a.textContent ?? "").includes(dict.cabinet_budgets_heading),
  ) ?? null;

describe("the cabinet-budgets cross-link on /budget", () => {
  it("is on the page and points at /indicators/budgets", () => {
    renderHub();
    const a = cabinetLink();
    expect(
      a,
      "the budget module has no link to /indicators/budgets",
    ).toBeTruthy();
    // The WHOLE href on a page carrying nothing — `split("?")[0]` would pass
    // on a dangling "?" that React Router only omits because `createPath`
    // skips an empty search.
    expect(a?.getAttribute("href")).toBe("/indicators/budgets");
    // The teaser, not just the heading — it is what says the page is about
    // cabinets rather than about a year.
    expect(document.body.textContent).toContain(dict.cabinet_budgets_teaser);
  });

  it("carries the selected election through to the destination", () => {
    renderHub("/budget?elections=2024_10_27");
    expect(cabinetLink()?.getAttribute("href")).toContain(
      "elections=2024_10_27",
    );
  });

  it("does not forward this page's own params", () => {
    // `fy` belongs to the sub-pages and means nothing on /indicators/budgets;
    // the pre-migration card forwarded the raw search and would carry it.
    renderHub("/budget?elections=2024_10_27&fy=2021");
    const href = cabinetLink()?.getAttribute("href") ?? "";
    expect(href).toContain("elections=2024_10_27");
    expect(href).not.toContain("fy=2021");
  });

  it("never exports a cabinet anchor to a series that spans every cabinet", () => {
    // The param that MATTERS here, and the one the allowlist decision is
    // actually about. `fy` above can never appear on /budget; `cabinet` can —
    // the moment this page joins the cabinet-anchor route group — and pinning
    // one cabinet on a page whose whole subject is comparing all of them
    // silently narrows it.
    renderHub("/budget?elections=2024_10_27&cabinet=denkov-2023");
    const href = cabinetLink()?.getAttribute("href") ?? "";
    expect(href).toContain("elections=2024_10_27");
    expect(href).not.toContain("cabinet");
  });

  it("renders without waiting for the stat call", async () => {
    // It is a static link, so it must not be gated on `stats` — a hub whose
    // API is down still has to offer the way out. Assert it BEFORE anything
    // data-driven has settled, then confirm the data really did arrive after.
    renderHub();
    expect(cabinetLink()).toBeTruthy();
    await screen.findAllByText(/€14,2 млрд\./);
    expect(cabinetLink()).toBeTruthy();
  });

  it("keeps the reader's election on the footer links too", () => {
    // They dropped it, so following one reset the election selector to the
    // latest — silently, since ElectionContext has no localStorage fallback.
    renderHub("/budget?elections=2024_10_27&fy=2021");
    for (const path of [
      "/budget/deep-dive",
      "/budget/methodology",
      "/budget/tax-calculator",
    ]) {
      const a = [...document.querySelectorAll("a")].find((x) =>
        (x.getAttribute("href") ?? "").startsWith(path),
      );
      expect(a, `no link to ${path}`).toBeTruthy();
      expect(a?.getAttribute("href"), path).toContain("elections=2024_10_27");
      expect(a?.getAttribute("href"), path).not.toContain("fy=2021");
    }
  });
});
