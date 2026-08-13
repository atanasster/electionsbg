// Gates for /budget/law.
//
// This page's headline is the most consequential sentence in the module — „N of
// 8 key budget documents" is read as a verdict on a country. Three ways it goes
// wrong, all of which produce a confident, wrong, publishable claim:
//
//   * SCORING FROM THE YEAR'S ROWS instead of the site-wide set. Every year
//     that lacks an audit report would score it absent nationally.
//   * SCORING A DEGRADED PAYLOAD. An empty set is „0 of 8" — the maximally
//     damaging claim, made from no data at all.
//   * PRESENTING COVERAGE AS A COUNTRY SCORE. Four slots have no ingest, and
//     „we do not collect X" is not „Bulgaria does not publish X".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import bgDict from "@/locales/bg/translation.json";
import { OBS_BUDGET_DOCS } from "@/lib/obsBudgetDocs";
import { BudgetLawScreen } from "./BudgetLawScreen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: uiLanguage };
    },
    t: (k: string, o?: Record<string, unknown>) => {
      const raw = (bgDict as Record<string, string>)[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

let uiLanguage = "bg";
const dict = bgDict as Record<string, string>;

/** FY2025 holds only the act — but the site as a whole holds four categories.
 *  Scoring from `rows` would report 1 of 8. */
const THIN_YEAR = {
  fiscalYear: 2025,
  obsCategoriesPresent: [
    "enacted-budget",
    "year-end-report",
    "audit-report",
    "in-year-report",
  ],
  rows: [
    {
      documentId: "law-2025",
      fiscalYear: 2025,
      kind: "law",
      titleBg: "Закон за държавния бюджет на Република България за 2025 г.",
      publishedOn: "2024-12-20",
      url: "https://example.invalid/zdbrb-2025",
      obsCategory: "enacted-budget",
      adoptedByItemId: null,
    },
  ],
};

let payload: unknown = THIN_YEAR;

beforeEach(() => {
  payload = THIN_YEAR;
  uiLanguage = "bg";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("budget-hub-stats")
        ? {
            ok: true,
            json: async () => ({
              fiscalYear: 2025,
              yearsAvailable: [2024, 2025, 2026],
            }),
          }
        : { ok: true, json: async () => payload },
    ),
  );
});

const renderIt = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/budget/law?fy=2025"]}>
        <BudgetLawScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("BudgetLawScreen", () => {
  it("asks the endpoint that exists", async () => {
    // `/api/db/<unknown>` answers `{"error": "unknown /api/db endpoint"}` at a
    // **200**, so a mistyped route is not an error anybody sees — the hook gets
    // a well-formed object, the page renders its empty state, and the whole
    // scorecard silently disappears. Shipped exactly that way for one build:
    // the route is `budget-law`, named for the page, while the SQL function
    // behind it is `budget_documents()`.
    renderIt();
    await waitFor(() => {
      const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes("/api/db/") && !u.includes("hub-stats"));
      expect(urls.length).toBeGreaterThan(0);
      expect(urls[urls.length - 1]).toMatch(/\/api\/db\/budget-law\b/);
    });
  });

  it("treats a 200 carrying `error` as no data, not as a payload", async () => {
    // `rows` is deliberately NOT an array. With `{error}` alone the screen's own
    // `rows ?? []` fallback produces the asserted DOM whether or not the hook
    // validates anything, so that fixture could not fail — this one can: an
    // unvalidated non-array reaches `.map()` and throws.
    payload = { error: "unknown /api/db endpoint", rows: { nope: true } };
    renderIt();
    await waitFor(() =>
      expect(screen.getByText(dict.budget_law_year_empty)).toBeTruthy(),
    );
    // Never „0 от 8" from an error body.
    expect(screen.queryByText(/събрани \d+ от 8/)).toBeNull();
  });

  it("scores the frame site-wide, not from the selected year", async () => {
    renderIt();
    // 4 — the site-wide set. The year holds ONE document; scoring from `rows`
    // would publish „1 от 8" and call three categories nationally absent.
    const line = await screen.findByText(/събрани 4 от 8 документа/);
    expect(line).toBeTruthy();
    expect(screen.queryByText(/събрани 1 от 8/)).toBeNull();
  });

  it("calls the score COVERAGE HERE, not a verdict on the country", async () => {
    renderIt();
    const caveat = await screen.findByText(dict.budget_law_frame_caveat);
    // The distinction is the point: four slots have no ingest at all.
    expect(caveat.textContent).toMatch(/покритието ТУК/);
    expect(caveat.textContent).toMatch(/може да съществува/);
  });

  it("makes NO claim that Bulgaria fails to publish a document", async () => {
    // The page shipped one and the suite defended it: „граждански бюджет … в
    // България не се издава". It is false — IBP's Open Budget Survey records a
    // Bulgarian citizens budget in 2019, 2021 and 2023 (67/100 in the last
    // round). A country-level claim needs a source this corpus does not
    // contain, and the coverage statement is complete without one.
    renderIt();
    await screen.findByText(/събрани 4 от 8 документа/);
    const body = document.body.textContent!;
    expect(body).not.toMatch(/не се издава|не се публикува|не публикува/);
    expect(body).not.toMatch(/does not publish|is not issued/i);
  });

  it("scores nothing at all when the route degrades", async () => {
    // The route's sentinel has no `obsCategoriesPresent`. An empty set would
    // tick none of the eight and announce „0 от 8" from no data.
    payload = { rows: [] };
    renderIt();
    // Wait for something ONLY the settled payload can produce. The intro is
    // static, so waiting on it resolves before the query returns and every
    // assertion below then passes against a DOM that has not scored anything
    // yet — which is how this gate first shipped unable to fail.
    await waitFor(() =>
      expect(screen.getByText(dict.budget_law_year_empty)).toBeTruthy(),
    );
    expect(screen.queryByText(/събрани \d+ от 8/)).toBeNull();
    expect(screen.queryByText(dict.budget_law_present)).toBeNull();
  });

  it("marks the four uncollected slots absent and the rest present", async () => {
    renderIt();
    await screen.findByText(/събрани 4 от 8 документа/);
    const items = [...document.querySelectorAll("ul li")];
    const stateOf = (labelBg: string) => {
      const li = items.find((n) => n.textContent?.includes(labelBg))!;
      // The BADGE, not the row text: „има" is a three-letter substring that
      // already occurs inside „Независимата" in audit-report's own description,
      // so a substring test over the row passes with every slot marked absent.
      const badge = li.querySelector("span[aria-hidden]")!;
      return badge.textContent === "✓" ? "present" : "absent";
    };
    const byId = Object.fromEntries(OBS_BUDGET_DOCS.map((d) => [d.id, d]));
    expect(stateOf(byId["enacted-budget"].labelBg)).toBe("present");
    expect(stateOf(byId["year-end-report"].labelBg)).toBe("present");
    expect(stateOf(byId["citizens-budget"].labelBg)).toBe("absent");
    expect(stateOf(byId["mid-year-review"].labelBg)).toBe("absent");
  });

  it("lists one document once, however many ids the corpus gave it", async () => {
    // 15 of the corpus's 48 records are the same document under two
    // `document_id` slug variants — same title, same URL, same date. FY2024
    // lists 19 records that are 11 documents.
    payload = {
      ...THIN_YEAR,
      rows: [
        THIN_YEAR.rows[0],
        { ...THIN_YEAR.rows[0], documentId: "law-2025-the" },
      ],
    };
    renderIt();
    await screen.findByText(/Закон за държавния бюджет/);
    expect(screen.getAllByText(/Закон за държавния бюджет/)).toHaveLength(1);
  });

  it("never claims a document was adopted without a vote", async () => {
    // `adopted_by_item_id` is NULL on all 48 rows — unresolved ingest work, not
    // a fact about the vote. Any UI that renders that absence as „no recorded
    // vote" publishes a false claim about parliament.
    renderIt();
    await screen.findByText(/Закон за държавния бюджет/);
    const body = document.body.textContent!;
    expect(body).not.toMatch(/без гласуване|не е гласуван|no recorded vote/i);
  });

  it("links each document to its source and opens it safely", async () => {
    renderIt();
    const link = await screen.findByText(/Закон за държавния бюджет/);
    const a = link.closest("a")!;
    expect(a.getAttribute("href")).toBe("https://example.invalid/zdbrb-2025");
    // External, so it must not hand the opener a window reference.
    expect(a.getAttribute("rel")).toMatch(/noopener/);
  });
});
