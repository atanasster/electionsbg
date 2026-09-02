// The promulgated State Budget Law (ЗДБРБ) as a КФП plan line.
//
// WHY THIS EXISTS. The КФП monthly feed carries a „Закон" (plan) column beside
// „Изпълнение", so for a normal year plan-vs-actual falls out of the feed with
// no help. FY2026 was not normal: the ЗДБРБ-2026 was promulgated on
// **31 July 2026** (ДВ бр. 69, УКАЗ № 271, adopted by the 52nd НС on 24 July),
// months into the year, so every 2026 observation ingested before that date has
// `planned: null` and the frame reported `hasPlan: false`. The plan existed; the
// feed we had did not carry it.
//
// The law is already parsed — `data/budget/derived/law_framework.json`, written
// by the budget ingest from the ДВ HTML — so the plan is recoverable without
// waiting for data.egov.bg to re-publish the monthly resource with the column
// filled.
//
// THE MAPPING, and why it is not a guess. The law's чл. 1 tables and the feed's
// five series are the same five quantities under different names:
//
//   feed `revenue`         = law I.   ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ
//   feed `expenditure`     = law II.  РАЗХОДИ  +  III. ТРАНСФЕРИ (НЕТО)
//                            — the feed's section is „II. Разходи И ТРАНСФЕРИ",
//                              so the law's II alone is ~half of it
//   feed `euContribution`  = law IV.  ВНОСКА В ОБЩИЯ БЮДЖЕТ НА ЕС
//   feed `balance`         = law V.   БЮДЖЕТНО САЛДО  =  I - II - III - IV
//
// Verified against the years where BOTH exist: for **2023, 2024 and 2025** the
// law-derived plan equals the feed's own `planned` line **to the euro on the
// three sections, and to €1 on the derived balance** (2023 derives
// -3,075,941,468 against the feed's -3,075,941,467 — a лева-conversion residue;
// 2024 and 2025 are exact). That is the evidence the mapping is right rather
// than plausible — a wrong split of II/III would miss by billions.
//
// ⚠️ 2021 and 2022 do NOT match (revenue off €967.0m and €689.1m), and that is
// expected rather than a defect: both years had an in-year актуализация, so the
// feed carries the УТОЧНЕН план while the law HTML we parse is the ORIGINAL.
// Hence `source`: a plan from the feed is the current one and always wins; a
// plan from the law is the law AS FIRST PROMULGATED and says so. Never present
// the two as interchangeable.
//
// ⚠️ `ParsedLawFramework.balance` is NULL for every year in the corpus — the
// parser does not read чл. 1 ал. 3 — so the balance here is DERIVED. That is
// safe because the derivation is checkable: for 2026 it comes out at
// **-7,319,804,000**, which is чл. 1 ал. 3's „V. БЮДЖЕТНО САЛДО (І-ІІ-ІІІ-IV)
// -7 319 804,0 хил. евро" exactly. `lawPlan.data.test.ts` pins that literal.

import { kfpBalance } from "./kfpIdentity";

/** The provenance string for a plan taken from the feed's own „Закон" column.
 *  Lives here, beside `kfpPlanFromLaw`'s required `note`, so both provenance
 *  strings belong to the module that owns the concept and a future qualifier
 *  („уточнен план" vs „по удължителен закон") has one place to go. */
export const KFP_FEED_PLAN_NOTE =
  "КФП месечен отчет, колона „Закон“ (уточнен план)";

/** The shape `law_framework.json` stores per year — the fields this module
 *  reads, structurally compatible with `ParsedLawFramework` from
 *  `law_html.ts`. Declared locally so the generator can read the JSON without
 *  dragging in the HTML parser. */
export interface LawFrameworkSectionLike {
  amount: { amountEur: number };
}

export interface LawFrameworkYearLike {
  fiscalYear: number;
  revenue: LawFrameworkSectionLike;
  expenditure: LawFrameworkSectionLike;
  transfers: LawFrameworkSectionLike;
  euContribution: LawFrameworkSectionLike;
  balance?: LawFrameworkSectionLike | null;
}

/** Where a plan line came from. The two are NOT interchangeable — see the
 *  актуализация note above. */
export type PlanSource = "feed" | "law";

export interface KfpPlan {
  fiscalYear: number;
  source: PlanSource;
  /** I. ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ */
  revenueEur: number;
  /** II. РАЗХОДИ + III. ТРАНСФЕРИ (НЕТО) — the feed's „Разходи и трансфери". */
  expenditureEur: number;
  /** IV. ВНОСКА В ОБЩИЯ БЮДЖЕТ НА ЕС */
  euContributionEur: number;
  /** V. БЮДЖЕТНО САЛДО = I - II - III - IV. Negative is a deficit. */
  balanceEur: number;
  /** Human-readable provenance, e.g. "ЗДБРБ-2026, ДВ бр. 69 от 31.07.2026". */
  note: string;
}

/**
 * Read one year of `law_framework.json` as a КФП plan line.
 *
 * @param law - The year's parsed чл. 1 framework, or null/undefined when the
 *   year is absent (a checkout without the derived artifact, or a year with no
 *   ЗДБРБ at all — 2026 ran on a bridging law until 31 July).
 * @param note - Provenance text shipped with the plan. Required: a plan with no
 *   citation is the thing this module exists to avoid.
 * @returns The plan, or null when the year is absent. Never throws — a missing
 *   law must degrade to "no plan", which is exactly what the frame already
 *   handles.
 */
export const kfpPlanFromLaw = (
  law: LawFrameworkYearLike | null | undefined,
  note: string,
): KfpPlan | null => {
  if (!law) return null;
  const revenueEur = law.revenue.amount.amountEur;
  // The feed's "expenditure" is „II. Разходи И ТРАНСФЕРИ"; the law splits the
  // two. Adding them is what makes the two comparable — the single most
  // load-bearing line in this file, and the one the 2023-2025 euro-exact
  // reconciliation proves.
  const expenditureEur =
    law.expenditure.amount.amountEur + law.transfers.amount.amountEur;
  const euContributionEur = law.euContribution.amount.amountEur;
  return {
    fiscalYear: law.fiscalYear,
    source: "law",
    revenueEur,
    expenditureEur,
    euContributionEur,
    // Derived, not read: the parser leaves чл. 1 ал. 3 unparsed for every year.
    // Prefer the law's own figure if it ever starts carrying one.
    balanceEur:
      law.balance?.amount.amountEur ??
      kfpBalance(revenueEur, expenditureEur, euContributionEur),
    note,
  };
};

/** One side's execution against its plan. */
export interface PlanExecution {
  ytdEur: number;
  plannedEur: number;
  /** `ytdEur / plannedEur`. Null when the plan line is zero or absent — never
   *  0, which would read as "nothing executed".
   *
   *  ⚠️ NEGATIVE means the two have OPPOSITE SIGNS, not under-execution. The
   *  normal case is a surplus year-to-date against a planned deficit: measured,
   *  2025-01 ran +€49,749,621 against a planned −€3,646,864,707, i.e.
   *  `pct = -0.0136`. The true statement there is "a surplus so far — none of
   *  the planned deficit has been run", so a consumer must not render a bare
   *  „−1.4% от планирания дефицит". */
  pct: number | null;
}

export interface PlanComparison {
  /** The year the PLAN is for. Carried so the artifact is self-checkable: a
   *  plan from the wrong year is internally consistent and cites the wrong ДВ
   *  issue, so nothing else in the payload would contradict it. */
  fiscalYear: number;
  source: PlanSource;
  note: string;
  throughMonth: number;
  revenue: PlanExecution;
  expenditure: PlanExecution;
  euContribution: PlanExecution;
  balance: PlanExecution;
}

const execution = (ytdEur: number, plannedEur: number): PlanExecution => ({
  ytdEur,
  plannedEur,
  // A deficit plan is negative and so is a deficit YTD, so the ratio is
  // positive and means "this share of the year's planned deficit has been
  // run" — the figure the whole comparison exists for.
  pct: plannedEur === 0 ? null : ytdEur / plannedEur,
});

/**
 * Year-to-date execution against a plan, per side.
 *
 * ⚠️ This is the plan-vs-actual a reader wants and the one that is easiest to
 * misread. Two things it is NOT:
 *
 *   · It is NOT pro-rata. Bulgarian budget execution is heavily back-loaded —
 *     measured on this feed, between 40.6% and 97.0% of the annual deficit
 *     accrues after July, and December alone carries 13.9%-75.1%. A revenue
 *     side at 53% and an expenditure side at 49% in month 7 is the NORMAL
 *     shape, not evidence the plan was inflated: 2023 ran 54.8% / 48.1% at
 *     month 7 and still closed at 87.7% of its planned deficit.
 *   · It is NOT the consolidated fiscal programme. Both sides here are the
 *     STATE budget — the feed is `constituentBudget: "state"` and the ЗДБРБ is
 *     the state budget law. The КФП deficit is a different, larger perimeter
 *     (state + общини + НОИ/НЗОК + ЕС сметки) that this repo does not hold on
 *     the expenditure side; see docs/budget_consolidated_kfp.md.
 */
export const comparePlan = (
  plan: KfpPlan,
  ytd: {
    throughMonth: number;
    revenueEur: number;
    expenditureEur: number;
    euContributionEur: number;
  },
): PlanComparison => ({
  fiscalYear: plan.fiscalYear,
  source: plan.source,
  note: plan.note,
  throughMonth: ytd.throughMonth,
  revenue: execution(ytd.revenueEur, plan.revenueEur),
  expenditure: execution(ytd.expenditureEur, plan.expenditureEur),
  euContribution: execution(ytd.euContributionEur, plan.euContributionEur),
  balance: execution(
    kfpBalance(ytd.revenueEur, ytd.expenditureEur, ytd.euContributionEur),
    plan.balanceEur,
  ),
});
