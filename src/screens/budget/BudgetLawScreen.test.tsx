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
import { bgCorpus as bgDict } from "@/locales/allKeys";
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

/** FY2026's SHAPE — a synthetic ordering probe, not a transcript. The corpus
 *  differs in three ways worth naming, since this page's whole discipline is
 *  saying which corpus a number came from: `law-2026` has no `published_on` at
 *  all, `interim-law-2026-0` is 2025-12-23, and FY2026 has no execution report
 *  yet. What is real is the STRUCTURE — the three-law package plus a bridging
 *  law — and the dates are chosen so a date-only sort produces a visibly wrong
 *  answer: the July fund laws above an August ЗДБРБ, and the execution report
 *  above the law it executes. */
const FULL_YEAR = {
  fiscalYear: 2026,
  obsCategoriesPresent: THIN_YEAR.obsCategoriesPresent,
  coverage: {
    monthsAvailable: 6,
    complete: false,
    firstPeriod: "2026-01",
    lastPeriod: "2026-06",
    asOf: "2026-06-30",
  },
  rows: [
    {
      documentId: "exec-2026-06",
      fiscalYear: 2026,
      kind: "execution-report",
      titleBg: "Информация за изпълнението към юни 2026",
      publishedOn: "2026-07-31",
      url: "https://example.invalid/exec-2026-06",
      obsCategory: "in-year-report",
      adoptedByItemId: null,
    },
    {
      documentId: "law-2026",
      fiscalYear: 2026,
      kind: "law",
      titleBg: "Закон за държавния бюджет на Република България за 2026 г.",
      publishedOn: "2026-08-01",
      url: "https://example.invalid/zdbrb-2026",
      obsCategory: "enacted-budget",
      adoptedByItemId: null,
    },
    {
      documentId: "fund-law-doo-2026-0",
      fiscalYear: 2026,
      kind: "fund-law",
      titleBg:
        "Закон за бюджета на държавното обществено осигуряване за 2026 г.",
      publishedOn: "2026-07-28",
      url: "https://example.invalid/zbdoo-2026",
      obsCategory: null,
      adoptedByItemId: null,
    },
    {
      documentId: "fund-law-nzok-2026-0",
      fiscalYear: 2026,
      kind: "fund-law",
      titleBg: "Закон за бюджета на НЗОК за 2026 г.",
      publishedOn: "2026-07-28",
      url: "https://example.invalid/zbnzok-2026",
      obsCategory: null,
      adoptedByItemId: null,
    },
    {
      documentId: "interim-law-2026-0",
      fiscalYear: 2026,
      kind: "interim-law",
      titleBg: "Закон за събирането на приходи и извършването на разходи",
      publishedOn: "2026-01-05",
      url: "https://example.invalid/interim-2026",
      obsCategory: null,
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

const renderIt = (search = "?fy=2025") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/budget/law${search}`]}>
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

  it("renders the corpus faithfully rather than deduping it", async () => {
    // This page used to dedupe on (url, title, date), because 15 of the
    // corpus's 48 records were the same 15 execution reports under a
    // pre-canonicalisation `document_id` slug and FY2024 listed 19 documents
    // that were 11. That is fixed at ingest now (mergeDocuments drops a
    // machine-derived record the build no longer mints; the invariant is gated
    // in scripts/budget/documents.test.ts), so the page must NOT filter.
    //
    // The distinction is not cosmetic. A display-time dedupe fixed this page
    // and nothing else — `budget_document`, the hub ledger's document counts
    // and the OGP coverage score read the same corpus and none of them dedupe
    // — so it hid a live corpus defect behind one correct-looking surface.
    // Restoring it would re-hide the next one.
    payload = {
      ...THIN_YEAR,
      rows: [
        THIN_YEAR.rows[0],
        { ...THIN_YEAR.rows[0], documentId: "law-2025-the" },
      ],
    };
    renderIt();
    await waitFor(() =>
      expect(screen.getAllByText(/Закон за държавния бюджет/)).toHaveLength(2),
    );
  });

  it("never claims a document was adopted without a vote", async () => {
    // `adopted_by_item_id` is NULL on all 33 rows — unresolved ingest work, not
    // a fact about the vote. Any UI that renders that absence as „no recorded
    // vote" publishes a false claim about parliament.
    renderIt();
    await screen.findByText(/Закон за държавния бюджет/);
    const body = document.body.textContent!;
    expect(body).not.toMatch(/без гласуване|не е гласуван|no recorded vote/i);
  });

  // ── T9.11 · the journey ───────────────────────────────────────────────────
  it("renders the year as a chain, not newest-first", async () => {
    // The whole point of the step. Sorted by publication date the execution
    // report for June lands above the law it executes and the bridging law that
    // governed the year until August sits below the budget act — a filing
    // cabinet rather than a sequence.
    payload = FULL_YEAR;
    renderIt("?fy=2026");
    await screen.findByText(/Закон за държавния бюджет/);
    // Scoped to the document list. `li a` across the page also catches the
    // breadcrumb, which would put „Управление" at the head of the chain and
    // make the assertion about navigation rather than about ordering.
    const list = [...document.querySelectorAll("ul")].find((ul) =>
      (ul.textContent ?? "").includes("Закон за държавния бюджет"),
    )!;
    const titles = [...list.querySelectorAll("a")]
      .map((a) => a.textContent ?? "")
      .filter((x) => x.length > 0);
    expect(titles).toEqual([
      // The bridging law governed the year UNTIL the budget act passed, so it
      // heads the chain — in this fixture by seven months.
      "Закон за събирането на приходи и извършването на разходи",
      "Закон за държавния бюджет на Република България за 2026 г.",
      // The fund budgets pass as one package with the ЗДБРБ…
      "Закон за бюджета на държавното обществено осигуряване за 2026 г.",
      "Закон за бюджета на НЗОК за 2026 г.",
      // …and the execution follows the laws it executes.
      "Информация за изпълнението към юни 2026",
    ]);
  });

  it("resolves a stage label for EVERY kind the corpus has", async () => {
    // The key is built as `budget_doc_kind_${kind.replace(/-/g, "_")}`, and a
    // miss renders the raw slug („execution-report") rather than failing. The
    // sibling tile uses `replace("-", "_")` — first occurrence only — which is
    // correct today only because every kind has exactly one hyphen.
    for (const kind of [
      "law",
      "interim-law",
      "fund-law",
      "amendment",
      "execution-report",
      "audit-report",
      "kfp-feed",
    ]) {
      const key = `budget_doc_kind_${kind.replace(/-/g, "_")}`;
      expect(dict[key], `no label for ${kind}`).toBeTruthy();
      expect(dict[key]).not.toBe(key);
    }
  });

  it("names each row's stage", async () => {
    // „Закон за изменение и допълнение на Закона за държавния бюджет" is an
    // amendment that reads like a law, so without the eyebrow the chain's order
    // is something the reader has to infer from the titles.
    payload = FULL_YEAR;
    renderIt("?fy=2026");
    await screen.findByText(/Закон за държавния бюджет/);
    const body = document.body.textContent!;
    expect(body).toContain(dict.budget_doc_kind_law);
    expect(body).toContain(dict.budget_doc_kind_fund_law);
    expect(body).toContain(dict.budget_doc_kind_interim_law);
    expect(body).toContain(dict.budget_doc_kind_execution_report);
  });

  it("says how far the year is reported, and that it is not over", async () => {
    // The journey's middle stage. Without it the chain reads law → audit with
    // the execution missing.
    payload = FULL_YEAR;
    renderIt("?fy=2026");
    await screen.findByText(/Закон за държавния бюджет/);
    const body = document.body.textContent!;
    // The PERIOD leads — „reported through June" is the exact answer…
    expect(body).toContain("Изпълнението е отчетено до 2026-06");
    // …and the snapshot count rides in the not-closed clause, where it cannot
    // be read as a year's worth.
    expect(body).toContain("6 месечни снимки, годината не е приключила");
  });

  it("⚠️ never renders the snapshot count as coverage of a CLOSED year", async () => {
    // FY2021, verbatim: `complete` with SIX snapshots, because the КФП feed is
    // cumulative year-to-date and its December row is the whole year. 152's
    // COMMENT ON COLUMN says outright that rendering this as coverage is false
    // about a complete year — and the first cut did exactly that, printing
    // „Отчетени 6 мес. по КФП" for a year that was fully reported. That is this
    // page under-reporting the state, on the page whose subject is the gap
    // between our coverage and the state's record.
    payload = {
      ...FULL_YEAR,
      coverage: {
        monthsAvailable: 6,
        complete: true,
        firstPeriod: "2021-06",
        lastPeriod: "2021-12",
        asOf: "2021-12-31",
      },
    };
    renderIt("?fy=2026");
    await screen.findByText(/Закон за държавния бюджет/);
    const body = document.body.textContent!;
    expect(body).toContain("Изпълнението е отчетено до 2021-12");
    // No „6" anywhere in the coverage line, and no not-closed clause.
    expect(body).not.toContain("6 месечни снимки");
    expect(body).not.toContain("годината не е приключила");
  });

  it("does not render a coverage line with no period to name", async () => {
    // `last_period` is nullable in 152. Ungated, the line renders
    // „Изпълнението е отчетено до " and stops.
    payload = {
      ...FULL_YEAR,
      coverage: { ...FULL_YEAR.coverage, lastPeriod: null },
    };
    renderIt("?fy=2026");
    await screen.findByText(/Закон за държавния бюджет/);
    expect(document.body.textContent).not.toContain(
      "Изпълнението е отчетено до",
    );
  });

  it("says nothing about coverage for a year the КФП feed does not reach", async () => {
    // `budget_fiscal_year` starts at 2021 while the documents start at 2018, so
    // a null coverage means „the execution feed has no such year" — NOT that
    // nothing was executed. Rendering a zero there would say the second.
    payload = { ...FULL_YEAR, coverage: null };
    renderIt("?fy=2026");
    await screen.findByText(/Закон за държавния бюджет/);
    const body = document.body.textContent!;
    expect(body).not.toContain("Изпълнението е отчетено");
    expect(body).not.toContain("годината не е приключила");
    expect(body).not.toMatch(/0 месечни снимки/);
  });

  it("scores the three-law package, and NOT for a year without fund laws", async () => {
    // ⚠️ The guard that matters. Fund budgets are catalogued from 2026, so
    // scoring FY2025 against the package reported „1 от 3 закона — още не са
    // приети: ЗБДОО, ЗБНЗОК" for a year whose fund budgets were passed and
    // simply not collected: a meter reading our own catalogue, captioned as the
    // state's.
    payload = FULL_YEAR;
    const full = renderIt("?fy=2026");
    await screen.findByText(/Закон за държавния бюджет/);
    expect(document.body.textContent).toContain("3 от 3 закона");
    full.unmount();

    payload = THIN_YEAR;
    renderIt();
    await screen.findByText(/Закон за държавния бюджет/);
    expect(document.body.textContent).not.toMatch(/от 3 закона/);
  });

  it("names WHICH laws are pending, in visible text", async () => {
    // The amber branch, which today's corpus cannot reach — 2026 is the only
    // fund-law year and its package is complete — so nothing else would catch a
    // regression in it. „1 от 3 закона" alone says a package is short without
    // saying which part; that half was reachable only by hovering a native
    // `title`, i.e. not at all on touch or with a screen reader.
    payload = {
      ...FULL_YEAR,
      rows: FULL_YEAR.rows.filter((r) => r.documentId !== "law-2026"),
    };
    renderIt("?fy=2026");
    await screen.findByText(/Закон за бюджета на НЗОК/);
    const body = document.body.textContent!;
    expect(body).toContain("2 от 3 закона");
    expect(body).toContain("ЗДБРБ");
    // Visible text, not a title attribute nobody can reach.
    expect(body).toContain("Още не са приети");
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
