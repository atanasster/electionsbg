// Gates for /budget/execution.
//
// The page draws a sum. Four ways that goes wrong, all of which produce a table
// that looks right:
//
//   * FOLDING THE EU CONTRIBUTION INTO EXPENDITURE. The identity still closes,
//     and §II is silently restated as €25.6bn — a figure the Ministry publishes
//     nowhere.
//   * CLAIMING THE IDENTITY WHEN IT DOES NOT HOLD. The sentence „the balance is
//     revenue minus expenditure minus the EU contribution" must not sit under
//     terms that do not add up to the balance printed beside them.
//   * RENDERING `financing` AS A SECOND FINDING. It is `-balance`, agreeing to
//     €5 003 on FY2024.
//   * TREATING AN UNFINISHED YEAR AS AN OUTTURN. FY2026 is reported to
//     2026-06-30, so every plan line looks massively undershot.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import bgDict from "@/locales/bg/translation.json";
import { BudgetExecutionScreen } from "./BudgetExecutionScreen";

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
/** `formatEur` groups with NBSP; test literals use ordinary spaces. */
const sp = (v: string | null) => (v ?? "").replace(/\u00a0/g, " ");

/** FY2024, verbatim from `/api/db/budget-year?fy=2024`. The identity closes to
 *  the euro: 22 263 692 630 − 24 775 124 952 − 814 052 657 = −3 325 484 979. */
const FY2024 = {
  fiscalYear: 2024,
  asOf: "2024-12-31",
  basis: "eur",
  complete: true,
  gdpEur: 104767200000,
  population: null,
  figures: {
    revenue: { actual: 22263692630, planned: 22193401114, projected: null },
    expenditure: {
      actual: 24775124952,
      planned: 25139137553,
      projected: null,
    },
    euContribution: {
      actual: 814052657,
      planned: 1161180522,
      projected: null,
    },
    balance: { actual: -3325484979, planned: -4106916961, projected: null },
    financing: { actual: 3325479976, planned: 4106916961, projected: null },
  },
  yearsAvailable: [2024, 2026],
};

/** FY2026 verbatim: `planned` NULL on all five (the year runs on an interim
 *  law), `projected` populated, outturn to 2026-06-30. This is the DEFAULT year
 *  a reader lands on. */
const FY2026 = {
  fiscalYear: 2026,
  asOf: "2026-06-30",
  basis: "eur",
  complete: false,
  gdpEur: 128155604775,
  population: null,
  figures: {
    revenue: { actual: 12796331646, planned: null, projected: 27292242746 },
    expenditure: {
      actual: 14150474073,
      planned: null,
      projected: 29577990982,
    },
    euContribution: { actual: 560263445, planned: null, projected: 1119699714 },
    balance: { actual: -1914405872, planned: null, projected: -3405447950 },
    financing: { actual: 1914405874, planned: null, projected: 3405447950 },
  },
  yearsAvailable: [2024, 2026],
};

let payload: unknown = FY2024;
/** Overridable so a test can move the EUROSTAT figure without touching the
 *  cash figures — which is the only way to prove the Maastricht badge reads
 *  the right one of the two. */
let peerB9: Record<string, number> | null = {
  year: 2025,
  bgPctGdp: -3.5,
  euAvgPctGdp: -3.1,
  rank: 19,
  total: 27,
};

beforeEach(() => {
  payload = FY2024;
  peerB9 = {
    year: 2025,
    bgPctGdp: -3.5,
    euAvgPctGdp: -3.1,
    rank: 19,
    total: 27,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("budget-hub-stats")
        ? {
            ok: true,
            json: async () => ({
              fiscalYear: 2024,
              yearsAvailable: [2024, 2026],
              peerBands: peerB9 ? { B9: peerB9 } : {},
            }),
          }
        : { ok: true, json: async () => payload },
    ),
  );
});

const renderIt = (fy = 2024) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/budget/execution?fy=${fy}`]}>
        <BudgetExecutionScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("BudgetExecutionScreen", () => {
  it("keeps the EU contribution as its own term", async () => {
    renderIt();
    await screen.findByText(dict.budget_exec_balance);
    const rows = [...document.querySelectorAll("tbody tr")].map((r) =>
      sp(r.textContent),
    );
    // Its own row, at its own value…
    expect(rows.some((r) => r.includes("€814 052 657"))).toBe(true);
    // …and expenditure is §II alone. €25 589 177 609 is the two folded
    // together — a figure МФ publishes nowhere.
    expect(rows.some((r) => r.includes("€24 775 124 952"))).toBe(true);
    expect(rows.join("|")).not.toContain("€25 589 177 609");
  });

  it("claims the identity only when the terms actually add up", async () => {
    renderIt();
    await screen.findByText(dict.budget_exec_identity);
    expect(screen.queryByText(dict.budget_exec_identity_broken)).toBeNull();
  });

  it("refuses the identity when the terms are merely CLOSE", async () => {
    // The „missing term" case below trips the earlier `sum == null` guard and
    // never reaches the comparison, so the tolerance itself was unheld:
    // Infinity, 1 and a bare `return true` all left the suite green. Every term
    // is present here and the balance is €50m out.
    payload = {
      ...FY2024,
      figures: {
        ...FY2024.figures,
        balance: { ...FY2024.figures.balance, actual: -3375484979 },
      },
    };
    renderIt();
    await screen.findByText(dict.budget_exec_identity_broken);
    expect(screen.queryByText(dict.budget_exec_identity)).toBeNull();
  });

  it("does not claim the identity when a term is missing", async () => {
    // Drop the EU contribution: the remaining terms are €2.5bn away from the
    // published balance, and the page must stop asserting one follows the other.
    payload = {
      ...FY2024,
      figures: { ...FY2024.figures, euContribution: undefined },
    };
    renderIt();
    await screen.findByText(dict.budget_exec_identity_broken);
    expect(screen.queryByText(dict.budget_exec_identity)).toBeNull();
  });

  it("calls financing the balance with its sign flipped", async () => {
    renderIt();
    const note = await screen.findByText(/Финансирането за годината/);
    expect(sp(note.textContent)).toContain("€3 325 479 976");
    expect(note.textContent).toMatch(/с обърнат знак/);
    // …and it never appears as a fifth row in the table.
    const rows = [...document.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(4);
  });

  it("says an unfinished year is not an outturn", async () => {
    payload = {
      ...FY2024,
      fiscalYear: 2026,
      asOf: "2026-06-30",
      complete: false,
    };
    renderIt(2026);
    const warn = await screen.findByText(/Годината още не е приключила/);
    // The as-of date, so „the difference is not final" is checkable.
    expect(warn.textContent).toContain("2026-06-30");
  });

  it("signs the deficit in front of the euro symbol", async () => {
    renderIt();
    await screen.findByText(dict.budget_exec_balance);
    const body = sp(document.body.textContent);
    // formatEur would give „€-3 325 484 979", burying the minus.
    expect(body).toContain("−€3 325 484 979");
    expect(body).not.toContain("€-3 325 484 979");
  });

  it("states that the EU band is a different perimeter", async () => {
    renderIt();
    // The SIGN is asserted. `/−?-?3\.2%/` made both optional, so rendering a
    // deficit as a positive 3.2% passed — on the one card where the sign is the
    // difference between a deficit and a surplus.
    await screen.findByText("-3.2%");
    expect(screen.getByText(dict.budget_exec_eu_basis)).toBeTruthy();
  });

  it("never divides a part-year balance by a full-year GDP", async () => {
    // The default year is OPEN. −1 914 405 872 / 128 155 604 775 = −1.5%, which
    // the untouched page printed four lines above „ЕС −3.1%". The corpus's own
    // annual answer is the projection's −2.7%.
    payload = FY2026;
    renderIt(2026);
    await screen.findByText(dict.budget_exec_gdp_h);
    const body = sp(document.body.textContent);
    expect(body).toContain("-2.7%");
    expect(body).not.toContain("-1.5%");
  });

  it("compares an open year against its projection, and says so", async () => {
    // FY2026 has NO plan — `planned` is NULL on all five series — so comparing
    // against it renders two full columns of em dashes under a banner about the
    // difference from plan.
    payload = FY2026;
    renderIt(2026);
    await screen.findByText(dict.budget_exec_balance);
    const heads = [...document.querySelectorAll("th")].map(
      (h) => h.textContent,
    );
    expect(heads).toContain(dict.budget_exec_col_projected);
    expect(heads).not.toContain(dict.budget_exec_col_plan);
    // …and the numbers are the projection's, not blanks.
    const rows = [...document.querySelectorAll("tbody tr")].map((r) =>
      sp(r.textContent),
    );
    expect(rows.some((r) => r.includes("€27 292 242 746"))).toBe(true);
  });

  it("shows a SHARE, not a shortfall, on an open year", async () => {
    // A half-year outturn minus a full-year projection is „−€14 495 911 100"
    // against revenue — which reads as a collapse rather than as June.
    payload = FY2026;
    renderIt(2026);
    await screen.findByText(dict.budget_exec_balance);
    const heads = [...document.querySelectorAll("th")].map(
      (h) => h.textContent,
    );
    expect(heads).toContain(dict.budget_exec_col_share);
    expect(heads).not.toContain(dict.budget_exec_col_delta);
    const body = sp(document.body.textContent);
    expect(body).not.toContain("14 495 911 100");
    // 12 796 331 646 / 27 292 242 746 = 46.9%
    expect(body).toContain("46.9%");
  });

  // ── T9.4 · the Maastricht badge ───────────────────────────────────────────
  //
  // Restored from the pre-migration screen, but moved onto the Eurostat line.
  // The 3% ceiling is defined on general-government net lending (ESA B.9); the
  // KFP cash ratio this page prints above it is a narrower perimeter the rule
  // does not govern. They disagree about the VERDICT in three of six years —
  // FY2025 most cleanly, since that is also the band's own year, so the
  // opposite verdict comes from perimeter alone (cash −2.68%, Eurostat −3.5%).
  //
  // EVERY assertion below anchors on the EUROSTAT SENTENCE, never on
  // `budget_exec_gdp_h`. That heading renders from `useBudgetYear` alone, so a
  // negative assertion anchored there runs before the stats query settles —
  // measured: with the hub-stats response delayed 200 ms, "shows no badge on a
  // surplus" passed with the suppression removed.
  // Proof the STATS query settled — the year chips are the only node on this
  // page rendered from `stats.yearsAvailable`, so it is the one anchor an
  // absence assertion can use when there is no band to render. `findByText(
  // budget_exec_source)` is NOT one: measured, it resolves while the page is
  // still the loading state, with no table and no GDP block at all, so both
  // null-band tests passed against a page that had rendered nothing.
  const statsSettled = () => screen.findByRole("button", { name: "2024" });

  const euSentence = () =>
    screen.findByText(
      (_, el) =>
        // The <p> itself, not every ancestor that contains it — an unscoped
        // matcher returns body/div/p and throws "found multiple elements".
        el?.tagName === "P" &&
        (el.textContent ?? "").includes("методологията на Евростат"),
    );

  it("badges the EUROSTAT figure, not the cash ratio beside it", async () => {
    // FY2026 cash projection is −2.66% — INSIDE. Eurostat is −3.5%, outside.
    // A badge computed from the cash ratio says „within" here and fails.
    payload = FY2026;
    renderIt(2026);
    await euSentence();
    expect(screen.getByText(dict.budget_maastricht_over_eurostat)).toBeTruthy();
    expect(
      screen.queryByText(dict.budget_maastricht_under_eurostat),
    ).toBeNull();
    // …and the cash ratio really is the inside-the-ceiling one, or the
    // assertion above is satisfied by both readings at once.
    expect(sp(document.body.textContent)).toContain("-2.7%");
  });

  it("says within the ceiling when Eurostat is inside it", async () => {
    peerB9 = {
      year: 2025,
      bgPctGdp: -2.4,
      euAvgPctGdp: -3.1,
      rank: 9,
      total: 27,
    };
    payload = FY2026;
    renderIt(2026);
    await euSentence();
    expect(
      screen.getByText(dict.budget_maastricht_under_eurostat),
    ).toBeTruthy();
    expect(screen.queryByText(dict.budget_maastricht_over_eurostat)).toBeNull();
  });

  it("treats exactly −3.0% as within, not above", async () => {
    // The ceiling is „above 3%". Written `<= -3` this flips, and no other
    // test moves: every one of them is at least 0.4pp from the boundary.
    peerB9 = {
      year: 2025,
      bgPctGdp: -3.0,
      euAvgPctGdp: -3.1,
      rank: 14,
      total: 27,
    };
    payload = FY2026;
    renderIt(2026);
    await euSentence();
    expect(
      screen.getByText(dict.budget_maastricht_under_eurostat),
    ).toBeTruthy();
  });

  it("shows no badge on a surplus, nor on an exact zero", async () => {
    // „within the ceiling" over a surplus is true and reads as faint praise
    // for unambiguously good news. The legacy tile suppressed it too. Zero is
    // the boundary: written `v > 0` it would badge a balanced budget.
    for (const bgPctGdp of [0.8, 0]) {
      peerB9 = { year: 2025, bgPctGdp, euAvgPctGdp: -3.1, rank: 1, total: 27 };
      payload = FY2026;
      const { unmount } = renderIt(2026);
      await euSentence();
      expect(
        screen.queryByText(dict.budget_maastricht_under_eurostat),
        `badged at ${bgPctGdp}% of GDP`,
      ).toBeNull();
      expect(
        screen.queryByText(dict.budget_maastricht_over_eurostat),
        `badged at ${bgPctGdp}% of GDP`,
      ).toBeNull();
      unmount();
    }
  });

  it("shows neither the EU sentence nor a badge when the figure is NULL", async () => {
    // The reachable state the `{band ? …}` wrapper hides: the row exists and
    // the figure is unpublished. Before this guard the sentence rendered
    // „България е на % от БВП" — measured, not hypothesised — and a
    // default-to-within badge could not be caught by any other test here.
    peerB9 = {
      year: 2025,
      bgPctGdp: null,
      euAvgPctGdp: -3.1,
      rank: 19,
      total: 27,
    } as unknown as Record<string, number>;
    payload = FY2026;
    renderIt(2026);
    await statsSettled();
    // The table proves the YEAR query settled too, so the GDP block below it
    // has had its chance to render.
    await screen.findByText(dict.budget_exec_balance);
    expect(sp(document.body.textContent)).not.toContain(
      "методологията на Евростат",
    );
    expect(
      screen.queryByText(dict.budget_maastricht_under_eurostat),
    ).toBeNull();
    expect(screen.queryByText(dict.budget_maastricht_over_eurostat)).toBeNull();
  });

  it("shows no badge when the peer band is absent entirely", async () => {
    peerB9 = null;
    payload = FY2026;
    renderIt(2026);
    // No band at all, so no stats-derived node beyond the chips.
    await statsSettled();
    await screen.findByText(dict.budget_exec_balance);
    expect(
      screen.queryByText(dict.budget_maastricht_under_eurostat),
    ).toBeNull();
    expect(screen.queryByText(dict.budget_maastricht_over_eurostat)).toBeNull();
  });
});
