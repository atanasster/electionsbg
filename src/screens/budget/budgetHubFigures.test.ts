// The /budget head's band — the plan/forecast rule, the structural zero, and the two locales.
//
// Every case here is a defect that reached the rendered page or a database in the wild;
// none is hypothetical. See `budgetHubFigures.ts` for why the pick and the caption are one
// operation, and `budgetBasis.test.ts` §2.3 for the corpus half of the same rule.

import { describe, it, expect } from "vitest";
import { budgetHubEvidence, budgetHubKpis } from "./budgetHubFigures";
import type { BudgetHubStats } from "@/data/budget/useBudgetHubStats";
import {
  BUDGET_STATS_FIXTURE as RUNNING,
  BUDGET_STATS_CLOSED_FIXTURE as CLOSED,
} from "./budgetHubStats.fixture";
import { bgCorpus, enCorpus } from "@/locales/allKeys";

/** The interpolating `t` a screen supplies, over the REAL corpus — so a caption assertion is
 *  about shipped copy rather than about a key name. */
const tFor =
  (corpus: Record<string, string>) =>
  (key: string, opts?: Record<string, unknown>): string =>
    (corpus[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name) =>
      String(opts?.[name] ?? ""),
    );

const nfFor = (l: string) => new Intl.NumberFormat(l);
const pctFor = (l: string) =>
  new Intl.NumberFormat(l, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

/** `Intl` compact output separates the unit with a NON-BREAKING space, so an assertion typed
 *  with an ordinary one fails on two strings that print identically. */
const nbsp = (s: string) => s.replace(/\u00a0/g, " ");

const build = (stats: BudgetHubStats, lang: "bg" | "en" = "bg") => {
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return budgetHubKpis(
    stats,
    locale,
    nfFor(locale),
    pctFor(locale),
    tFor(lang === "bg" ? bgCorpus : enCorpus),
  );
};

describe("budgetHubKpis", () => {
  it("captions a forecast year as a forecast, never as the budget law", () => {
    // THE DEFECT THIS FILE EXISTS FOR. FY2026 carries no `planned` row, so the €29,58 млрд.
    // in the band is `projectFigures`' output — ours. It shipped captioned „план за 2026".
    const money = build(RUNNING).slice(0, 2);
    expect(money).toHaveLength(2);
    for (const k of money) {
      expect(k.basis).not.toMatch(/план|закона за бюджета/i);
      expect(k.basis).toMatch(/прогноза/);
      expect(k.basis).toContain("2025"); // the seasonal anchor, named
    }
  });

  it("prefers the budget law wherever the corpus has one", () => {
    const [exp, rev] = build(CLOSED);
    expect(nbsp(exp.value)).toBe("€30,8 млрд.");
    expect(nbsp(rev.value)).toBe("€28,2 млрд.");
    expect(exp.basis).toMatch(/план по закона за бюджета/);
    expect(exp.basis).not.toMatch(/прогноз/);
  });

  it("keeps a full band on a CLOSED year", () => {
    // Before the law was exposed the band read only `projected`, which `kfp.ts` stops
    // producing once a year completes — so the day FY2026 closed the head would have
    // collapsed from four cells to one, with nothing failing.
    expect(build(CLOSED)).toHaveLength(4);
    expect(build(CLOSED).map((k) => k.label)).toEqual(
      build(RUNNING).map((k) => k.label),
    );
  });

  it("names the КФП perimeter on the share, in both languages", () => {
    // /budget/execution shows 41,7% of GDP (Eurostat, general government) one click away.
    expect(build(RUNNING)[2].basis).toContain("КФП");
    expect(build(RUNNING, "en")[2].basis).toContain("CFP");
  });

  it("says the share's DENOMINATOR is projected too, on a forecast year", () => {
    // macro.json's Eurostat series ends ~18 months back, so 2026's GDP is extrapolated.
    // „прогнозни разходи спрямо БВП" would present half the uncertainty.
    expect(build(RUNNING)[2].basis).toMatch(/прогнозен БВП/);
    expect(build(CLOSED)[2].basis).not.toMatch(/прогноз/);
  });

  it("formats the share through Intl, so bg gets a decimal COMMA", () => {
    // `${(23.1).toFixed(1)}%` renders „23.1%" beside „€29,6 млрд." — the slip a template
    // literal makes silently, and it shipped until the browser showed it.
    expect(build(RUNNING)[2].value).toBe("23,1%");
    expect(build(RUNNING, "en")[2].value).toBe("23.1%");
  });

  it("omits the programme cell when the ministry grain is absent", () => {
    // `program_count` is a `count(*)`, so it is 0 — never NULL — on any database that has
    // not run `db:load:budget:pg` (a REFRESH_EXCLUSIONS member whose input is gitignored).
    // „0 · Програми" in the largest type on the page is a structural zero read as a finding.
    const kpis = build({ ...RUNNING, programCount: 0 } as BudgetHubStats);
    expect(kpis).toHaveLength(3);
    expect(kpis.map((k) => k.label)).not.toContain(
      bgCorpus.budget_kpi_programs,
    );
  });

  it("drops a cell whose figure the corpus withholds, rather than zeroing it", () => {
    const kpis = build({
      ...RUNNING,
      revenuePlannedEur: null,
      revenueProjectedEur: null,
    } as BudgetHubStats);
    expect(kpis.map((k) => k.label)).not.toContain(bgCorpus.budget_kpi_revenue);
    expect(kpis).toHaveLength(3);
  });

  it("gives every cell a destination that can name its rows (§3.1 rule 4)", () => {
    const kpis = build(RUNNING);
    expect(kpis.every((k) => typeof k.to === "string" && k.to)).toBe(true);
    expect(new Set(kpis.map((k) => String(k.to))).size).toBe(kpis.length);
  });

  it("shares no VALUE with the executed figures the tiles carry (§3.1 rule 5)", () => {
    // Disjointness is a property of the current four cells, not of the design — the
    // `execution` tile's secondary metric is `balanceProjectedEur`, the same forecast family.
    const values = new Set(build(RUNNING).map((k) => nbsp(k.value)));
    for (const executed of [
      RUNNING.expenditureExecutedEur,
      RUNNING.revenueExecutedEur,
    ] as number[])
      expect(
        values.has(`€${(executed / 1e9).toFixed(1).replace(".", ",")} млрд.`),
      ).toBe(false);
  });

  it("returns nothing at all before the blob arrives", () => {
    expect(
      budgetHubKpis(
        undefined,
        "bg-BG",
        nfFor("bg-BG"),
        pctFor("bg-BG"),
        tFor(bgCorpus),
      ),
    ).toEqual([]);
  });
});

describe("budgetHubEvidence", () => {
  const evidence = (stats: BudgetHubStats, lang: "bg" | "en" = "bg") => {
    const locale = lang === "bg" ? "bg-BG" : "en-GB";
    return budgetHubEvidence(
      stats,
      locale,
      lang,
      nfFor(locale),
      tFor(lang === "bg" ? bgCorpus : enCorpus),
    );
  };

  it("ranks the five largest spending units, each to its OWN page", () => {
    const e = evidence(RUNNING)!;
    expect(e.rows).toHaveLength(5);
    // The corpus's OWN name, in full — see the note beside `label` for why it is not
    // shortened even though four of five share a 16-character prefix.
    expect(e.rows[0].label).toBe("Министерство на отбраната");
    expect(nbsp(e.rows[0].value)).toBe("€2,6 млрд.");
    // Descending, which is what makes it a leaderboard rather than an arbitrary five.
    const amounts = RUNNING.topSpendingUnits!.map((u) => u.eur);
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts);
    for (const r of e.rows)
      expect(String(r.to)).toMatch(/^\/budget\/ministry\/admin-/);
    expect(new Set(e.rows.map((r) => r.id)).size).toBe(5);
  });

  it("states the denominator, and says the rows are NOT the band's breakdown", () => {
    // The five rows sum to €8,6 млрд. under a band cell reading €29,6 млрд. — different
    // perimeters (ЗДБРБ per-ПРБ vs the consolidated КФП), so the caption has to carry both
    // the corpus total and the disclaimer or the aside reads as an arithmetic error.
    const e = evidence(RUNNING)!;
    expect(e.basis).toContain("44");
    // The separator is a NON-BREAKING space in `Intl` output — match either.
    expect(nbsp(e.basis!)).toMatch(/€13,3 млрд\./);
    expect(e.basis).toMatch(/не е разбивка/i);
    expect(e.basis).toMatch(/по-горе/);
    expect(evidence(RUNNING, "en")!.basis).toMatch(/not a breakdown/i);
  });

  it("REFUSES the list when its denominator is missing", () => {
    // A fragment of an unstated whole is the one thing this aside must never be. On a
    // database without the gitignored ministry grain the rows are absent anyway; the guard
    // is for the partial state, where rows exist and the totals do not.
    expect(
      evidence({ ...RUNNING, adminTotalPlannedEur: null } as BudgetHubStats),
    ).toBeUndefined();
    expect(
      evidence({ ...RUNNING, adminUnitCount: 0 } as BudgetHubStats),
    ).toBeUndefined();
    expect(
      evidence({ ...RUNNING, topSpendingUnits: [] } as BudgetHubStats),
    ).toBeUndefined();
  });

  it("falls back to the Bulgarian name when the corpus has no English one", () => {
    const units = RUNNING.topSpendingUnits!.map((u, i) =>
      i === 0 ? { ...u, nameEn: null } : u,
    );
    const e = evidence(
      { ...RUNNING, topSpendingUnits: units } as BudgetHubStats,
      "en",
    )!;
    // Never the nodeId slug, which is what a bare `||` chain on the wrong operand yields.
    expect(e.rows[0].label).toBe("Министерство на отбраната");
    expect(e.rows[1].label).toBe("Ministry of the Interior");
  });
});
