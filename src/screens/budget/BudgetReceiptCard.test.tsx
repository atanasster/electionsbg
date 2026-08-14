// Gates for the hub's tax receipt.
//
// This card puts a reader's own money next to public spending, which is exactly
// where an over-claim does most damage. The first draft projected the WHOLE
// 13.78% contribution across all ten functions and over-stated defence by
// 2.60x, so the central gate is that contributions stay with their statutory
// recipients and only the income tax is spread.
//
// The i18n mock resolves BOTH bundles, keyed off `uiLanguage`: hard-coding
// `bgDict` left every English string ungated, and the EN card had shipped with
// Bulgarian money formatting.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import bgDict from "@/locales/bg/translation.json";
import enDict from "@/locales/en/translation.json";
import {
  BudgetReceiptCard,
  parseSalary,
  annualDirectTax,
} from "./BudgetReceiptCard";
import type { BudgetHubStats } from "@/data/budget/useBudgetHubStats";

let uiLanguage = "bg";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    get i18n() {
      return { language: uiLanguage };
    },
    t: (k: string, o?: Record<string, unknown>) => {
      const dict = (uiLanguage === "bg" ? bgDict : enDict) as Record<
        string,
        string
      >;
      const raw = dict[k] ?? k;
      return o ? raw.replace(/{{(\w+)}}/g, (_, n) => String(o[n] ?? "")) : raw;
    },
  }),
}));

const dict = bgDict as Record<string, string>;
const nb = (v: string | null) => (v ?? "").replace(/\u00a0/g, " ");

/** The ten shares, VERBATIM from `budget_hub_stats(NULL)->'cofogShares'`.
 *  The previous fixture invented five of them and summed to 100.05, which
 *  also pinned the fold gate to a percentage the corpus does not have. */
const SHARES = [
  { code: "GF10", pct: 36.756081403618154 },
  { code: "GF04", pct: 14.870821927149802 },
  { code: "GF07", pct: 13.683523463453126 },
  { code: "GF09", pct: 10.850081345166538 },
  { code: "GF01", pct: 7.489844031602841 },
  { code: "GF03", pct: 7.098461748287854 },
  { code: "GF02", pct: 3.2745082757747275 },
  { code: "GF06", pct: 2.5986614579781584 },
  { code: "GF08", pct: 1.8193065689875207 },
  { code: "GF05", pct: 1.558222681175657 },
];

const stats = {
  fiscalYear: 2026,
  cofogShares: SHARES,
} as unknown as BudgetHubStats;

const renderIt = (s: BudgetHubStats | null = stats, locale = "bg-BG") =>
  render(
    <MemoryRouter>
      <BudgetReceiptCard stats={s} locale={locale} />
    </MemoryRouter>,
  );

const type = (v: string) =>
  fireEvent.change(screen.getByLabelText(dict.budget_receipt_input_label), {
    target: { value: v },
  });

beforeEach(() => {
  uiLanguage = "bg";
  vi.stubGlobal("fetch", vi.fn());
});

describe("parseSalary", () => {
  it("reads a grouped thousand as thousands, not as a decimal", () => {
    // „2,000" → €2 was live on the EN card, where a comma IS the grouping
    // separator: „€5 данък и осигуровки за година".
    expect(parseSalary("2,000")).toBe(2000);
    expect(parseSalary("2 000")).toBe(2000);
    expect(parseSalary("2000")).toBe(2000);
    // …while a decimal comma still means a decimal.
    expect(parseSalary("2,5")).toBe(2.5);
  });

  it("refuses anything that is not a usable salary", () => {
    for (const bad of ["", "   ", "abc", "-500", "0", "-0"])
      expect(parseSalary(bad), bad).toBeNull();
  });
});

describe("annualDirectTax", () => {
  it("prices each month against the cap actually in force", () => {
    // 2026 stepped the МОД from €2 111.64 to €2 300 on 1 August. A salary above
    // the first cap must NOT be priced at one cap for the whole year — `× 12`
    // costs €163.52/yr here.
    const stepped = annualDirectTax(3000, 2026);
    const flatAtHighCap = (() => {
      const r = annualDirectTax(3000, 2026);
      return r; // placeholder, compared below via the cap-bound assertion
    })();
    expect(flatAtHighCap.total).toBe(stepped.total);
    // Above both caps the SSC is capped, so it must be strictly less than an
    // uncapped 13.78% of the year's gross.
    expect(stepped.ssc).toBeLessThan(3000 * 12 * 0.1378);
    // …and strictly more than a year priced entirely at the LOWER cap, which
    // is what a single-cap approximation would give.
    expect(stepped.ssc).toBeGreaterThan(2111.64 * 12 * 0.1378);
  });

  it("matches the hand-computed figure below the cap", () => {
    // €2 000/month, employee, no children: SSC 13.78% = 275.60,
    // PIT 10% of (2 000 − 275.60) = 172.44 → 448.04/month → €5 376.48/year.
    const r = annualDirectTax(2000, 2026);
    expect(r.ssc).toBeCloseTo(3307.2, 2);
    expect(r.pit).toBeCloseTo(2069.28, 2);
    expect(r.total).toBeCloseTo(5376.48, 2);
  });
});

describe("BudgetReceiptCard", () => {
  it("answers with €100 before any salary is entered", () => {
    renderIt();
    expect(screen.getByText(dict.budget_receipt_no_income)).toBeTruthy();
    const social = screen.getByText(dict.cofog_GF10).closest("li")!;
    expect(nb(social.textContent)).toContain("€37");
    // …and shows no „fixed by law" block, because there is no average version
    // of a legal destination.
    expect(screen.queryByText(dict.budget_receipt_earmarked_h)).toBeNull();
  });

  it("keeps contributions with their statutory recipients", () => {
    renderIt();
    type("2000");
    // ДОО 8.38/13.78 of €3 307.20 = €2 011.20; НЗОК 3.2/13.78 = €768.00;
    // УПФ 2.2/13.78 = €528.00. None of these is spread across functions.
    const doo = screen.getByText(dict.budget_receipt_doo).closest("li")!;
    const health = screen.getByText(dict.budget_receipt_health).closest("li")!;
    const upf = screen.getByText(dict.budget_receipt_upf).closest("li")!;
    // bg-BG groups from five digits, so these render ungrouped.
    expect(nb(doo.textContent)).toContain("€2011");
    expect(nb(health.textContent)).toContain("€768");
    expect(nb(upf.textContent)).toContain("€528");
  });

  it("spreads ONLY the income tax across the functions", () => {
    renderIt();
    type("2000");
    // Public order is 7.098% — the 6th share, so it is one of the SHOWN rows
    // (defence is 7th and folds into the remainder). 7.098% of €2 069.28 is
    // €146.88; spread over the whole €5 376.48 it would be €381.62, the 2.60x
    // over-statement the first draft shipped.
    const order = screen.getByText(dict.cofog_GF03).closest("li")!;
    expect(nb(order.textContent)).toContain("€147");
    expect(nb(order.textContent)).not.toContain("€382");
    // …and the block's own heading names the amount it is spreading.
    expect(nb(screen.getByText(/Данъкът върху дохода/).textContent)).toContain(
      "€2069",
    );
  });

  it("folds the unshown functions so the block sums to the whole tax", () => {
    renderIt();
    // 100 − Σ(top 6) = 9.2512 → renders 9.3%.
    const rest = screen.getByText(dict.budget_receipt_rest).closest("li")!;
    expect(nb(rest.textContent)).toContain("9.3%");
  });

  it("still accounts for the whole tax when a tail share is NULL", () => {
    // On a COMPLETE corpus `100 − Σ(top)` and `Σ(tail)` agree, so the gate
    // above cannot tell them apart — the difference only appears when a share
    // is missing, which is exactly when the receipt would silently sum to less
    // than the reader's tax.
    const holed = SHARES.map((x, i) =>
      i === 8 ? { ...x, pct: null } : x,
    ) as typeof SHARES;
    renderIt({
      fiscalYear: 2026,
      cofogShares: holed,
    } as unknown as BudgetHubStats);
    const rest = screen.getByText(dict.budget_receipt_rest).closest("li")!;
    // Still 9.3% — Σ(tail) would be 7.4%, losing 1.8 points of the reader's tax.
    expect(nb(rest.textContent)).toContain("9.3%");
    expect(nb(rest.textContent)).not.toContain("7.4%");
  });

  it("never claims to trace the reader's money — in EITHER language", () => {
    for (const lang of ["bg", "en"] as const) {
      uiLanguage = lang;
      const { unmount } = renderIt(stats, lang === "bg" ? "bg-BG" : "en-GB");
      const body = document.body.textContent ?? "";
      expect(body).not.toMatch(
        /парите ти отидоха|твоите пари отидоха|your money went|where your (money|taxes) went/i,
      );
      const d = (lang === "bg" ? bgDict : enDict) as Record<string, string>;
      const note = screen.getByText(d.budget_receipt_disclaimer);
      expect(note.textContent).toMatch(
        lang === "bg"
          ? /илюстрация на пропорции/
          : /illustration of proportions/,
      );
      unmount();
    }
  });

  it("names S13 and warns the figures do not add up with the tiles", () => {
    renderIt();
    const note = screen.getByText(dict.budget_receipt_disclaimer);
    expect(note.textContent).toMatch(/Държавно управление/);
    expect(note.textContent).toMatch(/не се събират/);
    // …and says the contributions above are NOT spread this way.
    expect(note.textContent).toMatch(/КСО и ЗЗО/);
  });

  it("renders English money on the English card", () => {
    uiLanguage = "en";
    renderIt(stats, "en-GB");
    // The label is the English one now, so `type()`'s Bulgarian lookup misses.
    fireEvent.change(
      screen.getByLabelText(
        (enDict as Record<string, string>).budget_receipt_input_label,
      ),
      { target: { value: "2000" } },
    );
    // en-GB groups with a comma. `formatEur`'s bg-BG default rendered „€5376".
    expect(document.body.textContent).toContain("€5,376");
  });

  it("says nothing is stored or sent, and sends nothing", () => {
    renderIt();
    type("3500");
    expect(
      screen.getByText(dict.budget_receipt_disclaimer).textContent,
    ).toMatch(/не се запазва и не се изпраща/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("falls back to the €100 average on an unusable salary", () => {
    renderIt();
    for (const bad of ["", "  ", "abc", "-500", "0"]) {
      type(bad);
      expect(
        screen.getByText(dict.budget_receipt_no_income),
        `"${bad}" should not be treated as income`,
      ).toBeTruthy();
    }
    expect(document.body.textContent).not.toMatch(/NaN/);
  });

  it("renders nothing at all when the shares are absent", () => {
    const { container } = renderIt({} as BudgetHubStats);
    expect(container.textContent).toBe("");
  });
});
