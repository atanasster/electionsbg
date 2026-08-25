// The /budget head's KPI band, as a pure function over the hub stats blob.
//
// It is out of the component for the reason `src/screens/funds/fundsHubFigures.ts` is: a band
// built inline is unreachable from `hubHead.gates.test.ts`, whose strongest clause compares
// band values against tile metrics AS RENDERED STRINGS. Extracted, the /budget arm of that
// gate is three lines, and the plan/forecast rule below can be asserted rather than commented.

import type { HubEvidence, HubKpi } from "@/ux/infographic/HubHead";
import type { BudgetHubStats } from "@/data/budget/useBudgetHubStats";
import { formatEurCompact } from "@/lib/currency";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** The three money bases `budget_fiscal_year_figure` carries, in the order a headline prefers
 *  them. Only two are ever a HEADLINE — `actual` is the tiles' job. */
export type BudgetHeadlineBasis = "planned" | "projected";

/** ⚠️⚠️ THE ONE RULE THIS FILE EXISTS FOR: `planned` AND `projected` ARE DIFFERENT CLAIMS,
 *  AND THE LABEL MUST TRAVEL WITH THE FIGURE.
 *
 *  `planned` is МФ's own budget-law column off the КФП report — what the National Assembly
 *  appropriated, a number a reader can check against ЗДБРБ. `projected` is OURS: this year's
 *  actuals scaled through `projectionBasisYear`'s monthly profile (`scripts/budget/kfp.ts`,
 *  `projectFigures`). Measured on FY2026 they are not even both available — there is no
 *  `planned` row at all, and the head shipped €29,58 млрд. of forecast captioned „план по
 *  закона за бюджета" for one review cycle. That is a claim about what parliament voted,
 *  made out of arithmetic we did ourselves.
 *
 *  So the pick returns the VALUE AND ITS BASIS KEY TOGETHER. Two separate `??` chains — one
 *  choosing the number, one choosing the string — is the shape that desyncs, and it desyncs
 *  silently because both halves stay individually plausible. */
const pickHeadline = (
  planned: number | null,
  projected: number | null,
): { value: number; basis: BudgetHeadlineBasis } | null => {
  // The law first WHEREVER IT EXISTS: it is external, checkable and authoritative, and our
  // forecast of the same year is neither. On a closed year only `planned` survives (the
  // projection is not produced once `complete`), which is also what stops the band emptying
  // itself the day a fiscal year ends.
  if (planned != null) return { value: planned, basis: "planned" };
  if (projected != null) return { value: projected, basis: "projected" };
  return null;
};

/** Which caption goes with which basis, as DATA rather than as a conditional buried in a
 *  builder — so `budgetBasis.test.ts` §2.3 can enumerate the pairs and check each string in
 *  both corpora against the words it is not allowed to contain. A gate that had to grep the
 *  builder for „план" would go vacuous the moment the ternary moved. */
export const BUDGET_BASIS_KEYS: Record<
  "money" | "share",
  Record<BudgetHeadlineBasis, string>
> = {
  money: {
    planned: "budget_kpi_plan_basis",
    projected: "budget_kpi_projection_basis",
  },
  share: {
    planned: "budget_kpi_share_plan_basis",
    projected: "budget_kpi_share_projection_basis",
  },
};

/** The basis line for a money or share cell. `year` is the fiscal year; `basisYear` is the
 *  seasonal anchor, named on a forecast so „прогноза" is not a bare assertion. */
const basisText = (
  t: T,
  kind: "money" | "share",
  basis: BudgetHeadlineBasis,
  year: number,
  basisYear: number | null,
): string =>
  t(BUDGET_BASIS_KEYS[kind][basis], { year, basisYear: basisYear ?? year });

/** The head's four figures — and the whole design decision is that they are the year's
 *  ENVELOPE while the tiles are what has actually happened.
 *
 *  ⚠️⚠️ THE EXECUTED FIGURE MUST NEVER LEAD THIS PAGE. `expenditureExecutedEur` is
 *  €14,15 млрд. against €29,58 млрд. for the full year, because FY2026 is six months old
 *  (`asOf: 2026-06-30`, `complete: false`). Put it in the largest type on the page and the
 *  state appears to spend half what it does — the trap the dashboard-hub skill names by this
 *  hub's own name.
 *
 *  The two sets are disjoint, but NOT „by construction" — the `execution` tile's secondary
 *  metric is `balanceProjectedEur`, the same forecast family as a projected band cell. What
 *  makes them disjoint is that no FIGURE appears twice, which is a property of the current
 *  four cells and has to be re-checked when one changes. `hubHead.gates.test.ts` checks it. */
export const budgetHubKpis = (
  stats: BudgetHubStats | null | undefined,
  moneyLocale: string,
  nf: Intl.NumberFormat,
  pctFmt: Intl.NumberFormat,
  t: T,
): HubKpi[] => {
  if (!stats) return [];
  const year = stats.fiscalYear;
  const basisYear = stats.projectionBasisYear;
  const out: HubKpi[] = [];

  const exp = pickHeadline(
    stats.expenditurePlannedEur,
    stats.expenditureProjectedEur,
  );
  if (exp)
    out.push({
      value: formatEurCompact(exp.value, moneyLocale),
      label: t("budget_kpi_expenditure"),
      basis: basisText(t, "money", exp.basis, year, basisYear),
      to: "/budget/spending",
    });

  const rev = pickHeadline(stats.revenuePlannedEur, stats.revenueProjectedEur);
  if (rev)
    out.push({
      value: formatEurCompact(rev.value, moneyLocale),
      label: t("budget_kpi_revenue"),
      basis: basisText(t, "money", rev.basis, year, basisYear),
      to: "/budget/revenue",
    });

  // ⚠️ THE SHARE COMES FROM THE SERVER, already divided. `budgetBasis.test.ts` §7.1 forbids
  // dividing by GDP in a screen — a basis change done twice is the same question with two
  // implementations — and it caught the first draft doing exactly that. 156 emits one share
  // per numerator from the same `budget_fiscal_year` row, so the two can never be different
  // years, and this picks between them with the SAME rule that picked the money above.
  //
  // ⚠️ ITS CAPTION NAMES THE PERIMETER. /budget/execution renders 41,7% of GDP one click
  // away — Eurostat, general government — against this cell's ~23-27% on the КФП state
  // budget. Both are right; a caption saying only „спрямо БВП" invites the reader to
  // conclude one of the two pages is wrong. On a forecast year the DENOMINATOR is
  // extrapolated too (macro.json's Eurostat series ends ~18 months back), which is why the
  // projected variant of the string says so on both sides of the division.
  const share = pickHeadline(
    stats.expenditurePlannedPctGdp,
    stats.expenditureProjectedPctGdp,
  );
  if (share)
    out.push({
      value: pctFmt.format(share.value / 100),
      label: t("budget_kpi_share"),
      basis: basisText(t, "share", share.basis, year, basisYear),
      to: "/budget/execution",
    });

  // Truthiness, not `!= null`: `program_count` is a `count(*)`, so it returns 0 rather than
  // NULL on a database whose ministry grain was never loaded (`data/budget/ministries/` is
  // gitignored and `db:load:budget:pg` is a REFRESH_EXCLUSIONS member that skips rather than
  // fails). „0 · Програми" in the largest type on the page is this file's own rule about
  // structural zeros, broken at the top of the hub.
  if (stats.programCount)
    out.push({
      value: nf.format(stats.programCount),
      label: t("budget_kpi_programs"),
      basis: t("budget_kpi_programs_basis", { year }),
      to: "/budget/ministries",
    });

  return out;
};

/** The head's evidence aside: who the money is appropriated to, with names.
 *
 *  ⚠️⚠️ THE CAPTION IS NOT DECORATION HERE — it is what stops the list being read as a
 *  decomposition of the band above it. These five rows are ЗДБРБ per-ПРБ appropriations;
 *  the band's expenditure cell is the КФП consolidated programme, which also carries НОИ,
 *  НЗОК and the municipalities. Measured on FY2026: €13,25 млрд. across 44 units against
 *  €29,58 млрд. of projected КФП expenditure. Add the five visible rows and you get ~30% of
 *  the number directly above them, which reads as an error in one of the two.
 *
 *  So the list is REFUSED outright when its own denominator is missing. A fragment of an
 *  unstated whole is the one thing this aside must never be — the same rule
 *  `varianceCoveredUnits` states one file over („always beside its denominator"). */
export const budgetHubEvidence = (
  stats: BudgetHubStats | null | undefined,
  // ⚠️ `lang` is NARROWED, not a bare string, and the two parameters are adjacent for a
  // reason worth stating: at the call site both come from `i18n.language` — `moneyLocale`
  // is `"bg-BG"`/`"en-GB"`, `lang` is `"bg"`/`"en"` — so transposed they still TYPECHECK,
  // `Intl.NumberFormat("bg")` is valid so the money still formats, and `"bg-BG" === "bg"`
  // is false so a Bulgarian reader silently gets English unit names at a 200. The union is
  // what makes that a compile error.
  moneyLocale: string,
  lang: "bg" | "en",
  nf: Intl.NumberFormat,
  t: T,
): HubEvidence | undefined => {
  const rows = stats?.topSpendingUnits;
  if (!stats || !rows?.length) return undefined;
  if (!stats.adminTotalPlannedEur || !stats.adminUnitCount) return undefined;

  return {
    heading: t("budget_evidence_heading"),
    basis: t("budget_evidence_basis", {
      year: stats.fiscalYear,
      units: nf.format(stats.adminUnitCount),
      total: formatEurCompact(stats.adminTotalPlannedEur, moneyLocale),
    }),
    rows: rows.map((r) => ({
      // `nodeId`, not the name: two units can share one — „Министерство на земеделието" and
      // „…и храните" are one legal entity across a rename and both carry an appropriation —
      // and React then reuses the wrong row.
      id: r.nodeId,
      // ⚠️ THE CORPUS'S OWN NAME, IN FULL — do not shorten it, and the reason is measured
      // rather than aesthetic. `HubHead` truncates a label to the 340 px column, and four
      // of the five largest units begin with the identical „Министерство на ", so dropping
      // that prefix is the obvious fix: it takes the overflowing rows from three to one.
      // What it also does is RENAME them. „отбраната" and „труда и социалната политика" are
      // policy areas, not the names of the bodies the money is appropriated to, and this
      // aside's whole job is to put names beside the band. Measured in the browser at 1280,
      // the truncated forms are „Министерство на вътрешните раб…", „…на труда и социал…"
      // and „…на регионалното р…" — every one still distinguishing, so the ellipsis costs
      // nothing the rename would not cost more of.
      label: (lang === "bg" ? r.nameBg : r.nameEn || r.nameBg) || r.nodeId,
      value: formatEurCompact(r.eur, moneyLocale),
      // Each row to its OWN page, which is the strongest form of §3.1 rule 4: the
      // destination does not merely contain the row, it is about it.
      to: `/budget/ministry/${r.nodeId}`,
    })),
    action: { to: "/budget/ministries", label: t("budget_evidence_action") },
  };
};
