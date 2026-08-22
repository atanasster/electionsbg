// Gates for /budget/social-funds.
//
// ДОО collects €6.59bn and spends €12.59bn, and its balance is −€102m. Those
// three numbers are only reconcilable through the €5.89bn transfer in, and a
// page that omits it shows a €6bn hole beside a stated −€102m — from which a
// reader concludes one figure is wrong.
//
//     6 590 528 454 − 12 585 473 587 + 5 892 736 120 − 0 = −102 209 013
//
// Second: a year carries per-fund detail only once НОИ publishes the B1 sheets.
// The mid-cycle shell has no `funds`, and offering it renders an empty table
// under a year heading — „the funds reported nothing".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bgCorpus as bgDict } from "@/locales/allKeys";
import { formatEur } from "@/lib/currency";
import { BudgetSocialFundsScreen } from "./BudgetSocialFundsScreen";

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
const m = (amountEur: number) => ({
  amount: Math.round(amountEur * 1.95583),
  currency: "BGN",
  amountEur,
});

/** ДОО 2024, verbatim from `data/budget/noi/funds.json`. */
const DOO = {
  fundCode: "5500",
  fundLabelBg: "Държавно обществено осигуряване",
  fundLabelEn: "State social security",
  fiscalYear: 2024,
  asOf: "2024-12-31",
  revenue: m(6590528454),
  expenditure: m(12585473587),
  balance: m(-102209013),
  transfers: m(5892736120),
  transfersCentralBudget: m(5891263018),
  euContribution: m(0),
  taxRevenue: m(6480099521),
};

const TEACHERS = {
  ...DOO,
  fundCode: "5591",
  fundLabelBg: "Учителски пенсионен фонд",
  fundLabelEn: "Teachers' pension fund",
  revenue: m(68700085),
  expenditure: m(52504359),
  balance: m(16195726),
  transfers: m(0),
  transfersCentralBudget: m(0),
};

const FILE = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  source: { publisher: "НОИ", urlTemplate: "", description: "" },
  years: [
    // The mid-cycle shell: no per-fund detail at all.
    { fiscalYear: 2023, asOf: "2023-12-31", funds: [] },
    // A second DETAILED year, so the picker renders and `?fy` is exercised.
    // With one year `years.length > 1` is false and the whole control — plus
    // every `?fy` path — was uncovered.
    {
      fiscalYear: 2022,
      asOf: "2022-12-31",
      funds: [{ ...DOO, fiscalYear: 2022, revenue: m(6000000000) }],
    },
    { fiscalYear: 2024, asOf: "2024-12-31", funds: [DOO, TEACHERS] },
  ],
};

let payload: unknown = FILE;

/** The ЗБДОО plan, verbatim from data/budget/noi/fund_plan.json — all seven
 *  lines, not an abridgement. Six peer funds plus „Бюджет на НОИ", which is NOT
 *  one of them and is 43.3% of the law's own sum.
 *
 *  THE FULL SET IS LOAD-BEARING, not tidiness. чл. 1's headline is the GROSS
 *  SUM of the lines beneath it — that identity is what `types.ts`,
 *  `fundPlanView.ts` and the basis warning all turn on. An abridged fixture
 *  keeping the real €15,265,782,400 headline beside two lines totalling
 *  €12.54bn breaks it, and the 43.3% assertion then passes only BECAUSE the
 *  code divides by `sumOfFunds` instead of re-deriving it: a gate that could
 *  never see the difference between the two denominators. Here the parts add
 *  to the headline exactly, so the identity is assertable. */
const PLAN_FILE = {
  generatedAt: "2026-07-29",
  latestYear: 2026,
  years: [
    {
      fiscalYear: 2026,
      basis: "law",
      law: "Закон за бюджета на държавното обществено осигуряване за 2026 г.",
      dvIssue: "ДВ бр. 68 от 28.07.2026",
      idMat: "244982",
      sumOfFunds: {
        amount: 15265782400,
        amountEur: 15265782400,
        currency: "EUR",
      },
      lines: [
        {
          id: "pensions",
          bg: "Фонд „Пенсии“",
          en: "Pensions fund",
          isPeerFund: true,
          amount: {
            amount: 5572766500,
            amountEur: 5572766500,
            currency: "EUR",
          },
        },
        {
          id: "pensions_art69",
          bg: "Фонд „Пенсии за лицата по чл. 69“",
          en: "Pensions fund (art. 69 — uniformed services)",
          isPeerFund: true,
          amount: {
            amount: 931980900,
            amountEur: 931980900,
            currency: "EUR",
          },
        },
        {
          id: "pensions_non_labour",
          bg: "Фонд „Пенсии, несвързани с трудова дейност“",
          en: "Non-contributory pensions fund",
          isPeerFund: true,
          amount: {
            amount: 264736300,
            amountEur: 264736300,
            currency: "EUR",
          },
        },
        {
          id: "work_injury",
          bg: "Фонд „Трудова злополука и професионална болест“ (ТЗПБ)",
          en: "Work-injury & occupational-disease fund",
          isPeerFund: true,
          amount: {
            amount: 239126200,
            amountEur: 239126200,
            currency: "EUR",
          },
        },
        {
          id: "sickness_maternity",
          bg: "Фонд „Общо заболяване и майчинство“ (ОЗМ)",
          en: "Sickness & maternity fund",
          isPeerFund: true,
          amount: {
            amount: 1291204500,
            amountEur: 1291204500,
            currency: "EUR",
          },
        },
        {
          id: "unemployment",
          bg: "Фонд „Безработица“",
          en: "Unemployment fund",
          isPeerFund: true,
          amount: {
            amount: 355504700,
            amountEur: 355504700,
            currency: "EUR",
          },
        },
        {
          id: "noi",
          bg: "Бюджет на НОИ",
          en: "НОИ budget",
          isPeerFund: false,
          amount: {
            amount: 6610463300,
            amountEur: 6610463300,
            currency: "EUR",
          },
        },
      ],
    },
  ],
};
let planPayload: unknown = PLAN_FILE;

beforeEach(() => {
  payload = FILE;
  planPayload = PLAN_FILE;
  // ROUTED BY URL. The screen fetches two different files, and a stub that
  // answers both with the same body renders the B1 corpus as the ЗБДОО plan —
  // which is exactly the basis confusion these gates exist to prevent.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        String(url).includes("fund_plan") ? planPayload : payload,
    })),
  );
});

const renderIt = (search = "") =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[`/budget/social-funds${search}`]}>
        <BudgetSocialFundsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("BudgetSocialFundsScreen", () => {
  it("shows the transfer, so the balance is reconcilable", async () => {
    renderIt();
    const card = (
      await screen.findByText("Държавно обществено осигуряване")
    ).closest("div")!;
    const txt = nb(card.textContent);
    // All four terms, and the balance they produce.
    expect(txt).toContain("€6 590 528 454");
    expect(txt).toContain("€12 585 473 587");
    expect(txt).toContain("€5 892 736 120");
    expect(txt).toContain("−€102 209 013");
    // Without the transfer a reader would compute −€5 994 945 133.
    expect(txt).not.toContain("5 994 945 133");
  });

  it("claims the identity only when the terms produce the balance", async () => {
    renderIt();
    await screen.findByText("Държавно обществено осигуряване");
    expect(screen.getAllByText(dict.budget_funds_identity).length).toBe(2);
    expect(screen.queryByText(dict.budget_funds_identity_broken)).toBeNull();
  });

  it("refuses the identity when a term is inconsistent", async () => {
    payload = {
      ...FILE,
      years: [
        FILE.years[0],
        {
          ...FILE.years[1],
          funds: [{ ...DOO, transfers: m(4000000000) }],
        },
      ],
    };
    renderIt();
    await screen.findByText("Държавно обществено осигуряване");
    expect(screen.getByText(dict.budget_funds_identity_broken)).toBeTruthy();
    expect(screen.queryByText(dict.budget_funds_identity)).toBeNull();
  });

  it("states the self-funded share against the fund's OWN spending", async () => {
    renderIt();
    const line = await screen.findByText(/Собствените приходи покриват 52\.4%/);
    // 6 590 528 454 / 12 585 473 587 = 52.4%. Against revenue+transfers it
    // would be 52.8%, and against the balance it would be meaningless.
    expect(line).toBeTruthy();
  });

  it("names the central-budget transfer and links to the other side", async () => {
    renderIt();
    const line = await screen.findByText(/идват от централния бюджет/);
    expect(nb(line.textContent)).toContain("€5 891 263 018");
    const link = screen.getByText(dict.budget_funds_see_spending);
    // With the year: the default is 2024 here, and /budget/spending's own
    // default is 2026, so a bare link lands on a different year's line.
    expect(link.closest("a")?.getAttribute("href")).toBe(
      "/budget/spending?fy=2024",
    );
  });

  it("offers only the years that carry per-fund detail", async () => {
    renderIt();
    await screen.findByText("Държавно обществено осигуряване");
    const chips = [...document.querySelectorAll("button")]
      .map((b) => b.textContent)
      .filter((v) => /^\d{4}$/.test(v ?? ""));
    // 2023 is a yearbook-only shell — offering it renders an empty table under
    // a year heading, which reads as „the funds reported nothing".
    expect(chips).not.toContain("2023");
  });

  it("reads ?fy and carries it into the cross-link", async () => {
    renderIt("?fy=2022");
    await screen.findByText("Държавно обществено осигуряване");
    // The 2022 fixture's revenue, not 2024's.
    expect(nb(document.body.textContent)).toContain("€6 000 000 000");
    // …and the link to the other side of the transfer carries the year, or the
    // reader lands on a different year's figure.
    const link = screen.getByText(dict.budget_funds_see_spending);
    expect(link.closest("a")?.getAttribute("href")).toBe(
      "/budget/spending?fy=2022",
    );
  });

  it("says a MISSING term is missing, and does not blame НОИ", async () => {
    // `transfers` absent is a normal bucket-serving state — funds.json written
    // before those columns were parsed. Rendered through a two-way ternary it
    // read as „НОИ's published lines disagree", which is an accusation.
    payload = {
      ...FILE,
      years: [
        FILE.years[0],
        FILE.years[1],
        {
          ...FILE.years[2],
          funds: [{ ...DOO, transfers: undefined }],
        },
      ],
    };
    renderIt();
    await screen.findByText("Държавно обществено осигуряване");
    expect(screen.getByText(dict.budget_funds_identity_missing)).toBeTruthy();
    expect(screen.queryByText(dict.budget_funds_identity_broken)).toBeNull();
  });

  it("does not tell a self-funding fund its revenue falls short", async () => {
    // Учителски is 130.8% and ГВРС 133.5%. One sentence cannot serve both
    // directions, and the intro no longer generalises either.
    renderIt();
    const line = await screen.findByText(
      /Собствените приходи покриват 130\.8%/,
    );
    expect(line.textContent).toMatch(/издържа сам/);
    // ДОО still gets the shortfall wording.
    expect(
      screen.getByText(/Собствените приходи покриват 52\.4%/).textContent,
    ).not.toMatch(/издържа сам/);
  });

  it("holds the identity tolerance tight enough to matter", async () => {
    // €1 000 was never exercised: every fixture closed exactly, so Infinity,
    // 1 and a bare `true` all left the suite green. ГВРС closes to €1 in the
    // real file, so the tolerance must accept 1 and reject a real break.
    payload = {
      ...FILE,
      years: [
        FILE.years[0],
        FILE.years[1],
        {
          ...FILE.years[2],
          funds: [
            { ...DOO, fundLabelBg: "Точен", balance: m(-102209012) },
            {
              ...TEACHERS,
              fundLabelBg: "Счупен",
              balance: m(16195726 + 50000),
            },
          ],
        },
      ],
    };
    renderIt();
    const ok = (await screen.findByText("Точен")).closest("div")!;
    const bad = screen.getByText("Счупен").closest("div")!;
    // 1 EUR off — accepted, as the real ГВРС row is.
    expect(ok.textContent).toContain(dict.budget_funds_identity);
    // €50 000 off — refused.
    expect(bad.textContent).toContain(dict.budget_funds_identity_broken);
  });

  it("ranks the funds by size, not by the order the file listed them", async () => {
    payload = {
      ...FILE,
      years: [FILE.years[0], { ...FILE.years[1], funds: [TEACHERS, DOO] }],
    };
    renderIt();
    await screen.findByText("Държавно обществено осигуряване");
    const headings = [...document.querySelectorAll("h2")].map(
      (h) => h.textContent,
    );
    expect(headings[0]).toBe("Държавно обществено осигуряване");
  });

  // ── T9.10 · the ЗБДОО plan ────────────────────────────────────────────────
  //
  // The law's headline is a GROSS sum of its fund lines; the execution above it
  // is consolidated cash. Every gate here defends that boundary, because the
  // arithmetic of comparing them looks perfectly plausible.
  it("shows the statutory plan, and says it is not comparable", async () => {
    // NO ?fy: every assertion here is year-independent, and the fixture's
    // selectable years are [2022, 2024] — `?fy=2026` would not select 2026, it
    // would fall through to 2024 and quietly exercise a different branch than
    // the one the argument claims.
    renderIt();
    await screen.findByText(/Планът по закона/);
    const body = nb(document.body.textContent);
    expect(body).toContain("Фонд „Пенсии“");
    // The basis warning is the point of the block, not decoration.
    expect(body).toContain("не се сравняват");
    expect(body).toContain("БРУТЕН сбор");
    // …and it names the law it came from, so a reader can check it.
    expect(body).toContain("ДВ бр. 68 от 28.07.2026");
  });

  it("excludes the НОИ line from the fund list and says why", async () => {
    renderIt(); // year-independent — see the note above on ?fy=2026
    await screen.findByText(/Планът по закона/);
    const body = nb(document.body.textContent);
    // It is 43% of the law's sum and would be the largest entry — „НОИ spends
    // more than the pension fund" is a category error, not a finding.
    //
    // 6 610 463 300 / 15 265 782 400 = 43.3% — the LAW'S чл. 1 sum, which
    // INCLUDES the НОИ line itself. Against the six visible peer lines alone
    // (€8 655 319 100) the same money is 76.4%, and the sentence says „от сбора
    // по закона". Both are asserted, so the denominator is pinned rather than
    // reached by luck.
    expect(body).toContain("43.3%");
    expect(body).not.toContain("76.4%");
    // Present as an explanation…
    expect(body).toContain("не е показан тук");
    // …and NOT as a row in the list.
    const list = [...document.querySelectorAll("li")].map(
      (li) => li.textContent ?? "",
    );
    expect(list.some((x) => x.includes("Бюджет на НОИ"))).toBe(false);
  });

  it("draws the plan as a list, never as bars on a shared scale", async () => {
    // A bar carries an implicit shared axis, and the execution above is on a
    // different basis — so a bar is the one rendering that asserts the two are
    // comparable.
    renderIt(); // year-independent — see the note above on ?fy=2026
    await screen.findByText(/Планът по закона/);
    const planList = [...document.querySelectorAll("ul")].find((ul) =>
      (ul.textContent ?? "").includes("Фонд „Пенсии“"),
    );
    expect(planList).toBeTruthy();
    expect(planList!.querySelector("[style*='width']")).toBeNull();
  });

  it("names the plan's OWN year and flags that it is not the executed one", async () => {
    // ⚠️ THE TWO CORPORA DO NOT OVERLAP, and structurally cannot be expected
    // to: measured, B1 execution runs 2023-2024 while the only parsed ЗБДОО is
    // 2026. A law for year N passes before N begins; its execution report
    // arrives after N ends. A first draft gated this block on the selected
    // year and was therefore dead code on every page in the corpus.
    //
    // So the block shows the newest plan there is, names ITS year in the
    // heading, and says the year differs from the execution above.
    renderIt("?fy=2022");
    await screen.findByText(/Планът по закона/);
    const body = nb(document.body.textContent);
    // The heading carries 2026 — the plan's year, never the page's.
    expect(body).toContain("Планът по закона за 2026 г.");
    // …and the mismatch is stated, naming the executed year.
    expect(body).toContain("Това е ДРУГА година");
    expect(body).toContain("2022");
  });

  it("does not flag a mismatch when the years DO coincide", async () => {
    // The day НОИ publishes B1 for a year we already hold the law for, the
    // warning must go away — otherwise it becomes furniture nobody reads.
    planPayload = {
      ...PLAN_FILE,
      years: [{ ...PLAN_FILE.years[0], fiscalYear: 2024 }],
    };
    renderIt("?fy=2024");
    await screen.findByText(/Планът по закона/);
    const body = nb(document.body.textContent);
    expect(body).toContain("Планът по закона за 2024 г.");
    expect(body).not.toContain("Това е ДРУГА година");
  });

  it("prints the law's own чл. 1 sum, so the arithmetic closes on screen", async () => {
    // Without it the block shows one number (the six visible lines), names a
    // second (the excluded НОИ line) and states the second as a share of a
    // third that appears nowhere — a sentence the reader cannot check.
    renderIt();
    await screen.findByText(/Планът по закона/);
    const body = nb(document.body.textContent);
    expect(body).toContain("Заглавна сума по чл. 1");
    expect(body).toContain(nb(formatEur(15265782400)));
    // 8 655 319 100 (visible) + 6 610 463 300 (named) = 15 265 782 400. Every
    // term of that identity is now on the page.
    expect(body).toContain(nb(formatEur(6610463300)));
  });

  it("sums EVERY non-peer line, not just the first", async () => {
    // Today's ЗБДОО has exactly one („Бюджет на НОИ") and the ingest asserts it
    // — but that gate is on the WRITER. A `find` here would let a future second
    // line be silently omitted while this sentence still presented itself as
    // the explanation for the whole gap between the visible lines and чл. 1.
    // Without this fixture the filter/find choice is untestable, so the
    // robustness would be a claim rather than a property.
    const y = PLAN_FILE.years[0];
    const noi = y.lines[y.lines.length - 1];
    planPayload = {
      ...PLAN_FILE,
      years: [
        {
          ...y,
          lines: [
            ...y.lines.slice(0, -1),
            { ...noi, amount: { ...noi.amount, amountEur: 6410463300 } },
            {
              id: "reserve",
              bg: "Резерв",
              en: "Reserve",
              isPeerFund: false,
              amount: {
                amount: 200000000,
                amountEur: 200000000,
                currency: "EUR",
              },
            },
          ],
        },
      ],
    };
    renderIt();
    await screen.findByText(/Планът по закона/);
    const body = nb(document.body.textContent);
    // 6 410 463 300 + 200 000 000 = the same 6 610 463 300 and the same 43.3%.
    // Naming only the first would print €6 410 463 300 / 42.0%.
    expect(body).toContain(nb(formatEur(6610463300)));
    expect(body).toContain("43.3%");
    expect(body).not.toContain(nb(formatEur(6410463300)));
  });

  it("withholds the plan when no year was EXECUTED", async () => {
    // `fy` is null both transiently (the 3.7 KB plan file settles before the
    // 20 KB execution file) and durably — a yearbook-only corpus, which the
    // module header documents as a real mid-cycle state. Rendered there, the
    // block misreports itself twice over: the mismatch warning cannot name a
    // year to differ FROM so it is structurally suppressed, and the basis
    // warning's „числата по-горе" points at the empty-state message. A caveat
    // that vanishes exactly where the reader has least context is worse than
    // no block.
    payload = {
      ...FILE,
      years: [{ ...FILE.years[0], funds: [] }],
    };
    renderIt();
    await screen.findByText(dict.budget_funds_empty);
    const body = nb(document.body.textContent);
    expect(body).not.toContain("Планът по закона");
    // …and specifically not the basis warning, which would be pointing at
    // nothing.
    expect(body).not.toContain("БРУТЕН сбор");
  });

  it("keeps the two corpora apart — the plan never renders B1 figures", async () => {
    // The stub is URL-routed because a stub answering both files with the same
    // body rendered the B1 corpus AS the ЗБДОО plan. That routing is correct;
    // this asserts the outcome it exists for, so a future `useNoiFundPlan`
    // reading funds.json fails loudly rather than through a fixture detail.
    renderIt();
    await screen.findByText(/Планът по закона/);
    // The card is the plan HEADING's parent — not the first <div> containing
    // the text, which is an ancestor wrapping the whole page and therefore
    // contains every B1 figure too.
    const heading = [...document.querySelectorAll("h2")].find((h) =>
      (h.textContent ?? "").includes("Планът по закона"),
    );
    expect(heading).toBeTruthy();
    const inPlan = nb(heading!.parentElement!.textContent);
    // A figure that exists ONLY in the plan file…
    expect(inPlan).toContain(nb(formatEur(5572766500)));
    // …and none that exists only in the B1 execution file.
    expect(inPlan).not.toContain(nb(formatEur(DOO.revenue.amountEur)));
    expect(inPlan).not.toContain(nb(formatEur(DOO.expenditure.amountEur)));
  });

  it("survives the plan file being absent", async () => {
    planPayload = null;
    renderIt("?fy=2024");
    // Anchored on the SOURCE line, which renders only after the B1 fetch
    // resolves (it interpolates `year.asOf`). The page title is in both
    // <Title> and the <h1> and is present before any fetch settles, so an
    // absence assertion behind it would run against an empty page.
    await screen.findByText(/2024-12-31/);
    expect(nb(document.body.textContent)).not.toContain("Планът по закона");
  });
});
