// Data hook for the НОИ (ДОО) sector pack. Same shape as useRoads: the buyer's
// full per-contract corpus comes once from /api/db/awarder-contracts (НОИ ≈ 2.3k
// rows), is windowed CLIENT-SIDE to the host's [from, to) scope, then fed to the
// pure buildNoiModel engine. The pack also fuses the ДОО fund-execution snapshot
// (useNoiFunds — pensions / benefits / Персонал / Издръжка) so the procurement
// ledger can be set against the €12bn fund it sits inside — the differentiator
// no procurement-only portal has.

import { useMemo } from "react";
import { useAwarderGroupModel, type ScopeWindow } from "./useAwarderGroupModel";
import { useNoiFunds } from "@/data/budget/useBudget";
import {
  buildNoiModelFromAggregates,
  NOI_EIK,
  type NoiModel,
} from "@/lib/noiAttributes";
import type { NoiFundsFile } from "@/data/budget/types";
import {
  DOO_FUND_CODE,
  fundPensionsEur,
  latestCompleteNoiYear,
} from "@/data/budget/noiYear";
import { toEur } from "@/lib/currency";

/*  Държавно обществено осигуряване (DOO_FUND_CODE, imported above). The pack is
 *  titled "Всеки лев на ДОО" and the tiles say "изплатени от ДОО", so every
 *  figure must be this fund alone — not the sum across the three funds НОИ
 *  administers. УчПФ (5591) and ГВРС (5592) are separate funds with their own
 *  budgets; folding them in shifted expenditure by ~€54M and moved the
 *  contribution/transfer shares by ~0.3pp against a label that promised ДОО.
 *  The budget views (BudgetSocialFundsTile, BudgetFlowSocialFundsDrilldown)
 *  correctly keep the all-funds rollup — they are about the social funds
 *  collectively.
 *
 *  The constant and the pension accessor now live in noiYear.ts because the
 *  sectors-hub generator needs the same figure offline, and reading
 *  `totals.pensions` there reproduced exactly the ~€52.5M rollup error this
 *  comment describes — on the hub tile that links to this very pack. */

export { NOI_EIK };
// The pack takes its scope-window type from here.
export type { ScopeWindow };

/** The single ДОО fiscal-year snapshot the pack renders (the most recent
 *  ingested year), flattened to the figures the tiles need. Admin = Персонал +
 *  Издръжка executed, summed across the funds НОИ administers. */
export interface NoiFundYear {
  fiscalYear: number;
  expenditureEur: number; // total fund outflow (pensions + benefits + admin …)
  pensionsEur: number;
  benefitsEur: number;
  revenueEur: number; // section I — ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ (NOT contributions)
  /** I.1 Данъчни приходи — social-security contributions proper. Section I also
   *  carries fines, property income and fees (≈€0.11bn for ДОО in 2024), so this
   *  is the figure to label "вноски". Null on a pre-flag artifact. */
  contributionsEur: number | null;
  /** III. Трансфери — the state top-up, and the honest numerator for "how much
   *  of the fund is the budget?". Null on a pre-flag artifact, in which case
   *  callers fall back to `expenditure - revenue` — which overstates it by the
   *  residual deficit that section VI finances. */
  transfersEur: number | null;
  personnelEur: number;
  operationsEur: number;
  adminEur: number; // personnel + operations
  capitalEur: number;
  pensionTypes: NoiFundsFile["years"][number]["pensionTypes"];
}

export interface NoiData {
  model: NoiModel | null;
  fundYear: NoiFundYear | null;
  isLoading: boolean;
}

/** BGN (whole leva) → EUR. The per-fund pension/benefit split is stored in leva
 *  only; the rollup `totals` are the sole place carrying a precomputed EUR. */
const bgnToEur = (bgn: number | null): number =>
  bgn == null ? 0 : Math.round(toEur(bgn, "BGN") ?? bgn);

/** What /pensions actually renders its fund figures from. EXPORTED for the
 *  sectors-hub gate (sector_stats.data.test.ts), which asserts the hub tile and
 *  this page publish one figure — a hand-rolled reproduction of this path there
 *  would stay green on exactly the divergence the gate exists to catch, since
 *  the page's half would no longer be observed. */
export const flattenFundYear = (
  file: NoiFundsFile | null,
): NoiFundYear | null => {
  if (!file || !file.years.length) return null;
  // Latest year carrying real fund detail. Taking the raw max would select the
  // mid-cycle shell and render adminEur/revenue = 0, i.e. a false "0% covered
  // by contributions / 100% state transfer" claim and a vanished admin tile.
  const y = latestCompleteNoiYear(file.years);
  if (!y) return null;
  // ДОО alone — never y.totals, which rolls up all three funds (see
  // DOO_FUND_CODE). A complete year without a 5500 snapshot would mean the B1
  // ingest ran for the minor funds only; the pack has nothing to say then.
  const doo = y.funds.find((f) => f.fundCode === DOO_FUND_CODE);
  if (!doo || !doo.expenditure) return null;

  let personnelEur = 0;
  let operationsEur = 0;
  let capitalEur = 0;
  for (const l of doo.expenseLines) {
    const e = l.executed?.amountEur ?? 0;
    if (l.id === "personnel") personnelEur += e;
    else if (l.id === "operations") operationsEur += e;
    else if (l.id === "capital_assets" || l.id === "capital_transfers")
      capitalEur += e;
  }
  return {
    fiscalYear: y.fiscalYear,
    expenditureEur: doo.expenditure.amountEur,
    // Via the shared accessor, so this pack and the /governance/sectors tile
    // cannot drift apart again. `?? 0` covers a 5500 snapshot whose pension
    // line is null (pensionsBgn is nullable, and the guard above only checks
    // `expenditure`) — same result as the bgnToEur(null) this replaced.
    pensionsEur: fundPensionsEur(doo) ?? 0,
    benefitsEur: bgnToEur(doo.shortTermBenefitsBgn),
    revenueEur: doo.revenue?.amountEur ?? 0,
    contributionsEur: doo.taxRevenue?.amountEur ?? null,
    transfersEur: doo.transfers?.amountEur ?? null,
    personnelEur,
    operationsEur,
    adminEur: personnelEur + operationsEur,
    capitalEur,
    // The yearbook's pension-type split is itself ДОО-scope (its grand total
    // tracks ДОО's pension line, not the three-fund rollup), so it stays as is.
    pensionTypes: y.pensionTypes,
  };
};

export const useNoi = (
  eik: string = NOI_EIK,
  windowOverride?: ScopeWindow,
): NoiData => {
  const eiks = useMemo(() => [eik], [eik]);
  const gm = useAwarderGroupModel(
    eiks,
    buildNoiModelFromAggregates,
    windowOverride,
  );
  const funds = useNoiFunds();

  const fundYear = useMemo(
    () => flattenFundYear(funds.data ?? null),
    [funds.data],
  );

  return {
    model: gm.model,
    fundYear,
    isLoading: gm.isLoading || funds.isLoading,
  };
};

/** Just the flattened ДОО fund year — for the /pensions view, which wants the
 *  fund-execution figures without paying to load НОИ's whole contract corpus
 *  (the awarder pack's job). Same source and shape as useNoi().fundYear. */
export const useNoiFundYear = (): {
  fundYear: NoiFundYear | null;
  isLoading: boolean;
} => {
  const funds = useNoiFunds();
  const fundYear = useMemo(
    () => flattenFundYear(funds.data ?? null),
    [funds.data],
  );
  return { fundYear, isLoading: funds.isLoading };
};
