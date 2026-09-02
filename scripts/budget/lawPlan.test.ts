// The ЗДБРБ → КФП plan mapping, driven against synthetic frameworks.
// `lawPlan.data.test.ts` is the corpus half — it proves the mapping against the
// three years where the feed publishes its own plan and the two must agree to
// the euro.
import { describe, expect, it } from "vitest";
import {
  comparePlan,
  kfpPlanFromLaw,
  type LawFrameworkYearLike,
} from "./lawPlan";

const eur = (amountEur: number) => ({ amount: { amountEur } });

/** I 100 · II 40 · III 50 · IV 5 ⇒ balance 100 − 90 − 5 = 5. */
const FRAMEWORK: LawFrameworkYearLike = {
  fiscalYear: 2026,
  revenue: eur(100),
  expenditure: eur(40),
  transfers: eur(50),
  euContribution: eur(5),
  balance: null,
};

describe("kfpPlanFromLaw", () => {
  // The single load-bearing line: the feed's section is „II. Разходи И
  // ТРАНСФЕРИ", so the law's II alone is roughly half of it. Taking II without
  // III understates the planned spending by the whole transfer envelope —
  // €16.9bn on the real 2026 law — and makes the plan look wildly overspent.
  it("adds the law's II and III to reach the feed's expenditure section", () => {
    const plan = kfpPlanFromLaw(FRAMEWORK, "note")!;
    expect(plan.expenditureEur).toBe(90);
    expect(plan.expenditureEur).not.toBe(40);
  });

  it("carries revenue and the EU contribution straight through", () => {
    const plan = kfpPlanFromLaw(FRAMEWORK, "note")!;
    expect(plan.revenueEur).toBe(100);
    expect(plan.euContributionEur).toBe(5);
  });

  // The parser leaves чл. 1 ал. 3 unread for every year in the corpus, so this
  // path is the one that always runs.
  it("derives the balance as I - II - III - IV when the law has none", () => {
    expect(kfpPlanFromLaw(FRAMEWORK, "note")!.balanceEur).toBe(5);
  });

  it("prefers the law's own balance when it carries one", () => {
    const plan = kfpPlanFromLaw({ ...FRAMEWORK, balance: eur(-7) }, "note")!;
    expect(plan.balanceEur).toBe(-7);
  });

  it("stamps the source and the citation", () => {
    const plan = kfpPlanFromLaw(FRAMEWORK, "ЗДБРБ-2026, ДВ бр. 69")!;
    expect(plan.source).toBe("law");
    expect(plan.note).toBe("ЗДБРБ-2026, ДВ бр. 69");
    expect(plan.fiscalYear).toBe(2026);
  });

  // A checkout that never ran the budget ingest has no law_framework.json, and
  // a year before its ЗДБРБ has no entry. Both must degrade to "no plan"
  // rather than throw — the frame already handles null.
  it("returns null for a missing year rather than throwing", () => {
    expect(kfpPlanFromLaw(null, "note")).toBeNull();
    expect(kfpPlanFromLaw(undefined, "note")).toBeNull();
  });
});

describe("comparePlan", () => {
  const plan = kfpPlanFromLaw(FRAMEWORK, "note")!;
  const ytd = {
    throughMonth: 6,
    revenueEur: 50,
    expenditureEur: 45,
    euContributionEur: 2,
  };

  it("reports each side's year-to-date share of its own plan line", () => {
    const c = comparePlan(plan, ytd);
    expect(c.revenue.pct).toBeCloseTo(0.5, 12);
    expect(c.expenditure.pct).toBeCloseTo(45 / 90, 12);
    expect(c.euContribution.pct).toBeCloseTo(0.4, 12);
    expect(c.throughMonth).toBe(6);
    expect(c.source).toBe("law");
  });

  // The balance side compares the DERIVED year-to-date balance against the
  // planned one — 50 − 45 − 2 = 3 against a plan of 5.
  it("derives the year-to-date balance rather than taking it from a side", () => {
    const c = comparePlan(plan, ytd);
    expect(c.balance.ytdEur).toBe(3);
    expect(c.balance.plannedEur).toBe(5);
    expect(c.balance.pct).toBeCloseTo(0.6, 12);
  });

  // A deficit plan and a deficit YTD are both negative, so the ratio is
  // positive and reads as "this share of the year's planned deficit has been
  // run". Getting the sign wrong here inverts the whole comparison.
  it("keeps the deficit ratio positive when both sides are deficits", () => {
    const deficitPlan = kfpPlanFromLaw(
      { ...FRAMEWORK, revenue: eur(80) },
      "note",
    )!;
    expect(deficitPlan.balanceEur).toBe(-15);
    const c = comparePlan(deficitPlan, {
      throughMonth: 6,
      revenueEur: 40,
      expenditureEur: 45,
      euContributionEur: 2,
    });
    expect(c.balance.ytdEur).toBe(-7);
    expect(c.balance.pct).toBeCloseTo(7 / 15, 12);
    expect(c.balance.pct!).toBeGreaterThan(0);
  });

  // Null, never 0: a zero plan line means "no plan for this side", and 0%
  // would render as "nothing executed" against a real year-to-date figure.
  it("reports null rather than zero when a plan line is zero", () => {
    const zeroed = kfpPlanFromLaw(
      { ...FRAMEWORK, euContribution: eur(0) },
      "note",
    )!;
    const c = comparePlan(zeroed, ytd);
    expect(c.euContribution.pct).toBeNull();
    expect(c.euContribution.ytdEur).toBe(2);
  });
});
