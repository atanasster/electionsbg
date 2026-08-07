// The Interreg arm, shared by every AI tool that answers an EU-money question.
//
// WHY THIS FILE EXISTS. `fund_projects` (ИСУН) contains ZERO Interreg projects,
// and that is a system boundary rather than a filter: Interreg runs on Jems
// while the Bulgarian operational programmes run on ИСУН 2020. Because Interreg
// is cross-border by definition, everything it funds sits on a border — so a
// tool that answers "how much EU money does this place get" from ИСУН alone is
// not merely incomplete, it is incomplete in a systematically biased direction,
// against exactly the poorest and most depopulated municipalities. Measured on
// the full corpus: 213 of 256 ranked общини change rank once Interreg is
// counted, Генерал Тошево by 43 places.
//
// Every helper here FAILS SOFT to null. A tool that already answers from ИСУН
// must keep answering when a database has no Interreg corpus (a checkout before
// migration 137, or a Cloud SQL that never ran the loader) — the arm is
// additive, never load-bearing.

import { fetchDb } from "./dataClient";
import { fmtEurCompact } from "./format";
import type { ToolContext } from "./types";
import { oblastToCanon } from "@/lib/regionalOblast";

export interface InterregOverviewLite {
  budgetEur: number;
  partnerCount: number;
  operationCount: number;
  programmeCount: number;
  periods: Record<string, { budgetEur: number; linkedCount: number }>;
  oblasts: Record<
    string,
    { budgetEur: number; partnerCount: number; operationCount: number }
  >;
}

export interface InterregPlaceLite {
  budgetEur: number;
  operationCount: number;
  partnerCount: number;
  unpublishedPartnerCount: number;
  operations: {
    keepId: number;
    titleEn: string;
    titleBg: string | null;
    period: string;
    programmeBg: string | null;
    programmeEn: string | null;
    localBudgetEur: number | null;
    operationTotalEur: number | null;
  }[];
}

export const tryInterregOverview =
  async (): Promise<InterregOverviewLite | null> => {
    try {
      return await fetchDb<InterregOverviewLite>("interreg-overview", {});
    } catch {
      return null;
    }
  };

/** One place's Interreg money.
 *
 * `obshtina` MUST be the raw code, NOT the ИСУН funds key. The two corpora
 * disagree on exactly one place: `interreg_partners` says `SFO_CITY` while the
 * funds tree keys Sofia city `S22`. A caller that reuses its already-mapped
 * funds key here silently loses Столична община's €88.7m — 22.6% of the placed
 * corpus — and every row count still reconciles. */
export const tryInterregPlace = async (
  obshtina: string,
): Promise<InterregPlaceLite | null> => {
  try {
    const r = await fetchDb<InterregPlaceLite>("interreg-place", { obshtina });
    return r && r.operationCount > 0 ? r : null;
  } catch (e) {
    // Logged, unlike the other helpers, because THIS null is load-bearing: in
    // placeEuProjects' no-ИСУН branch it flips the answer back to "No EU-funds
    // projects for X" — the exact sentence this tier exists to stop a border
    // municipality from being told. A fetch failure and a genuinely
    // Interreg-less place are otherwise indistinguishable.
    console.warn(
      `interreg-place(${obshtina}) failed — answering without the Interreg arm:`,
      (e as Error)?.message ?? e,
    );
    return null;
  }
};

/** Interreg euros for one oblast, keyed the way `aggregateRegionalOblasts`
 *  keys its rows. Returns 0 for an oblast with none, so callers can add
 *  unconditionally. */
export const interregForOblast = (
  overview: InterregOverviewLite | null,
  canon: string,
): number => {
  if (!overview?.oblasts) return 0;
  let sum = 0;
  for (const [code, v] of Object.entries(overview.oblasts))
    if (oblastToCanon(code) === canon) sum += v.budgetEur ?? 0;
  return sum;
};

/** The sentence every widened tool appends. States the corpus, the amount, and
 *  the ONE thing a reader would otherwise get wrong: these are the Bulgarian
 *  partner's own budgets, not the cross-border project totals. */
export const interregNote = (
  eur: number,
  lang: ToolContext["lang"],
  bg = lang === "bg",
): string =>
  bg
    ? `Включва ${fmtEurCompact(eur, lang)} по Interreg (keep.eu) — трансгранични ` +
      `проекти, които не са в ИСУН, защото Interreg се управлява на отделна ` +
      `система. Сумата е бюджетът на българските партньори, не общият бюджет на ` +
      `проектите.`
    : `Includes ${fmtEurCompact(eur, lang)} of Interreg (keep.eu) — cross-border ` +
      `projects absent from ИСУН because Interreg is run on a separate system. ` +
      `The amount is the Bulgarian partners' own budgets, not the whole-project ` +
      `totals.`;

/** The disclosure for tools that CANNOT add the arm — every absorption /
 *  "% изплатени" answer. keep.eu publishes no expenditure field at all
 *  (`total_expenditure` and `eu_funding_expenditure` are NULL on every sampled
 *  partnership), so an absorption rate including Interreg cannot be computed
 *  rather than merely being unavailable. Saying so is the honest alternative to
 *  quietly reporting an ИСУН-only rate as the national one. */
export const absorptionScopeNote = (lang: ToolContext["lang"]): string =>
  lang === "bg"
    ? "Само по ИСУН. Interreg няма публикуван показател за изплатени средства " +
      "(keep.eu не публикува разходи), затова трансграничните проекти не влизат " +
      "в процента усвояване — нито в числителя, нито в знаменателя."
    : "ИСУН only. Interreg publishes no expenditure figure at all (keep.eu has " +
      "none), so cross-border projects are outside this absorption rate — " +
      "neither in the numerator nor the denominator.";
