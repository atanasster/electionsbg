// Gates for /budget/deviations.
//
// Three claims, all of which the corpus punishes getting wrong:
//
//   * THE COVERAGE PAIR IS STATED. 8 of 48 units file an execution report in
//     the best year. A top-N without that line asserts „these are the
//     government's biggest deviations" over a corpus that cannot support it.
//   * A ZERO-COVERAGE YEAR IS A FINDING. FY2026 has 0 of 44. Drawing an empty
//     table under „План срещу отчет" reads as „nobody deviated".
//   * TWO DELTAS, NOT ONE — and the amendment columns appear only when an
//     amendment exists. Only two amendment documents exist in the whole corpus,
//     so a permanent column of em dashes reads as missing data rather than as
//     „parliament did not re-vote this year".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import bg from "@/locales/bg/translation.json";
import { BudgetDeviationsScreen } from "./BudgetDeviationsScreen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: uiLanguage };
    },
    t: (k: string, o?: Record<string, unknown>) => {
      const raw = (bg as Record<string, string>)[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

let uiLanguage = "bg";

const WITH_AMENDMENT = {
  fiscalYear: 2024,
  complete: true,
  coveredUnits: 8,
  totalUnits: 48,
  rows: [
    {
      nodeId: "admin-mo",
      nameBg: "Министерство на отбраната",
      // Empty string, not null — the shape that made a row render nameless on
      // /en in T6.4. `??` sails past it; `||` does not.
      nameEn: "",
      plannedEur: 1088639606,
      amendedEur: 1830457486,
      executedEur: 1829092100,
      deltaVsLawEur: 740452494,
      deltaVsAmendedEur: -1365386,
    },
  ],
};

const NO_AMENDMENT = {
  fiscalYear: 2021,
  complete: true,
  coveredUnits: 3,
  totalUnits: 44,
  rows: [
    {
      nodeId: "admin-mo",
      nameBg: "Министерство на отбраната",
      nameEn: "MoD",
      plannedEur: 1000,
      amendedEur: null,
      executedEur: 1200,
      deltaVsLawEur: 200,
      deltaVsAmendedEur: 200,
    },
  ],
};

const NOTHING_FILED = {
  fiscalYear: 2026,
  // Still running — an execution report is not due, so its zero is the
  // calendar rather than a finding.
  complete: false,
  coveredUnits: 0,
  totalUnits: 44,
  rows: [],
};

let payload: unknown = WITH_AMENDMENT;

beforeEach(() => {
  payload = WITH_AMENDMENT;
  uiLanguage = "bg";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("budget-hub-stats")
        ? {
            ok: true,
            json: async () => ({
              fiscalYear: 2024,
              yearsAvailable: [2021, 2024, 2026],
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
      <MemoryRouter initialEntries={[`/budget/deviations?fy=${fy}`]}>
        <BudgetDeviationsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const dict = bg as Record<string, string>;

describe("BudgetDeviationsScreen", () => {
  it("states the coverage pair above the ranking", async () => {
    renderIt();
    const line = await screen.findByText(/публикували отчет за 2024/);
    // Both numbers, and the units count — NOT the row count. Rows are
    // (nodeId × kind), so 14/97 for the same year.
    expect(line.textContent).toMatch(/8 от 48/);
    // Above, not below: a coverage note read after a ranking has already been
    // read does not qualify it.
    const table = document.querySelector("table")!;
    expect(
      line.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("calls a CLOSED year with no reports a finding, and draws no table", async () => {
    // 2021 is behind the newest year in `yearsAvailable`, so reports are
    // overdue and the silence is the finding.
    payload = { ...NOTHING_FILED, fiscalYear: 2021, complete: true };
    renderIt(2021);
    await screen.findByText(/публикували отчет за 2021/);
    expect(screen.getByText(dict.budget_dev_coverage_none)).toBeTruthy();
    // No empty table under a heading that would read as „nobody deviated".
    expect(document.querySelector("table")).toBeNull();
  });

  it("does not accuse a year that has not closed", async () => {
    // 2026 IS the newest year: an execution report cannot exist yet, so the
    // same zero must read as the calendar rather than as silence. Merged into
    // one sentence, the page calls 44 ministries delinquent for being early.
    payload = NOTHING_FILED;
    renderIt(2026);
    await screen.findByText(/публикували отчет за 2026/);
    expect(screen.getByText(dict.budget_dev_coverage_pending)).toBeTruthy();
    expect(screen.queryByText(dict.budget_dev_coverage_none)).toBeNull();
  });

  it("shows both deltas when an amendment exists", async () => {
    renderIt();
    await screen.findByText("Министерство на отбраната");
    const heads = [...document.querySelectorAll("th")].map(
      (h) => h.textContent,
    );
    expect(heads).toContain(dict.budget_dev_col_amended);
    expect(heads).toContain(dict.budget_dev_col_delta_law);
    expect(heads).toContain(dict.budget_dev_col_delta_amended);
    // The two deltas genuinely differ here — €740m against the act, −€1.4m
    // against the amendment. Collapsed into one column, this ministry reads as
    // a €740m overspend when parliament had already voted the money.
    // NBSP group separators, so match flexibly. The SIGN is what is asserted:
    // „+" for over the act, „−" for under the amendment.
    expect(screen.getByText(/^\+€740.452.494$/)).toBeTruthy();
    expect(screen.getByText(/^−€1.365.386$/)).toBeTruthy();
  });

  it("hides the amendment columns when no amendment exists", async () => {
    payload = NO_AMENDMENT;
    renderIt();
    await screen.findByText("Министерство на отбраната");
    const heads = [...document.querySelectorAll("th")].map(
      (h) => h.textContent,
    );
    expect(heads).not.toContain(dict.budget_dev_col_amended);
    expect(heads).not.toContain(dict.budget_dev_col_delta_amended);
    // …and the note says WHY, rather than leaving the reader to infer that the
    // data is missing.
    expect(
      screen.getByText(dict.budget_dev_delta_note_no_amendments),
    ).toBeTruthy();
  });

  it("falls back to the Bulgarian name when the English one is blank", async () => {
    uiLanguage = "en";
    renderIt();
    // `??` would render an empty link cell with three money columns beside it.
    await waitFor(() =>
      expect(screen.getByText("Министерство на отбраната")).toBeTruthy(),
    );
  });

  it("says nothing at all when the route degrades", async () => {
    // `/api/db/budget-variance` answers this exact object when migration 155 is
    // absent. Rendered, the untouched page produced „ от  разпоредители са
    // публикували отчет за  г." and then told the reader the year was still
    // running — for a year the payload never named.
    payload = { rows: [], coveredUnits: null, totalUnits: null };
    renderIt();
    await waitFor(() =>
      expect(screen.getByText(dict.budget_dev_intro)).toBeTruthy(),
    );
    expect(screen.queryByText(/разпоредители са публикували отчет/)).toBeNull();
    expect(screen.queryByText(dict.budget_dev_coverage_pending)).toBeNull();
    expect(screen.queryByText(dict.budget_dev_coverage_none)).toBeNull();
    expect(document.querySelector("table")).toBeNull();
  });

  it("does not print the same delta twice for an unadjusted row", async () => {
    // A year can have some units adjusted and others not. For an unadjusted row
    // `deltaVsAmended` IS `deltaVsLaw`, so printing it under a second heading
    // asserts an independent finding that happens to agree.
    payload = {
      ...WITH_AMENDMENT,
      rows: [
        WITH_AMENDMENT.rows[0],
        {
          ...WITH_AMENDMENT.rows[0],
          nodeId: "admin-plain",
          nameBg: "Ведомство без уточнен план",
          amendedEur: null,
          deltaVsLawEur: 500,
          deltaVsAmendedEur: 500,
        },
      ],
    };
    renderIt();
    const row = (await screen.findByText("Ведомство без уточнен план")).closest(
      "tr",
    )!;
    // €500 appears ONCE in that row — under „Δ спрямо закона" only.
    expect(row.textContent!.match(/500/g)!.length).toBe(1);
  });

  it("links every row to its own spending-unit page", async () => {
    renderIt();
    const link = await screen.findByText("Министерство на отбраната");
    expect(link.closest("a")?.getAttribute("href")).toBe(
      "/budget/ministry/admin-mo",
    );
  });
});
