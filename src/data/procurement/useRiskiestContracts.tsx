// Top contracts by number of fired risk checks — the contract-grain sibling of
// useAwarderRiskTop (which ranks BUYERS). Reads the generic /api/db/table
// engine against the server-side index (contract_risk_cache, migration 112), so
// the ranking is over the whole SCOPE rather than a loaded page.
//
// ⚠️ Orders by `risk_fired`, not `risk_cri`. The CRI divides by a denominator
// that varies 7..11, so it is only almost monotone in the fired count — a
// 4-of-11 contract scores 36 and a 3-of-8 scores 38. For a "most-flagged"
// board that inversion would be visible and wrong, so the count leads and the
// CRI is only the tiebreak.
//
// ⚠️ Bounded by the ?pscope window like every other tile on the dashboard. It
// used to rank the whole corpus regardless: under the default "this parliament"
// scope the board showed contracts signed years outside the window it was sitting
// under, which reads as "these are the riskiest contracts of this parliament".
// The window is applied on `date`, the same column the contracts browser bounds,
// so the "see all" destination returns the same set.

import { useQuery } from "@tanstack/react-query";
import type { RiskGradeLetter } from "@/lib/riskGrade";
import type { RiskMaskRow } from "@/lib/contractRiskMask";
import { useScopeWindow } from "@/data/scope/useScopeWindow";
import { fetchTablePage } from "./fetchTablePage";

/** The grades this board ranks — the elevated tail (3+ fired checks, ~0.84% of
 *  the corpus). Exported so the "see all" link filters the contracts browser to
 *  exactly the set the tile previews. */
export const RISKIEST_GRADES: RiskGradeLetter[] = ["D", "E", "F"];

type RiskiestContractRow = {
  key: string;
  date?: string;
  dateSigned?: string;
  awarderName?: string;
  contractorName?: string;
  title?: string;
  amountEur?: number;
  riskFired?: number;
  riskAvailable?: number;
  riskCri?: number;
  riskGrade?: RiskGradeLetter;
};

/**
 * A leaderboard row, INCLUDING every field the mask decoder reads.
 *
 * The intersection is the point. This type used to hand-list `riskFiredMask` and
 * stop there — which type-checked perfectly while omitting `riskAvailableMask`
 * (so `contractRiskFromMasks` would return null for every row) plus four
 * magnitude inputs. It only worked at runtime because `fetchRiskiest` casts
 * untyped JSON and the server's default projection happens to include them.
 *
 * Nor does that degrade gracefully: without `signingAmountEur` the annex-growth
 * chip renders `+{formatShare(annexGrowthPct ?? 0)}` = "+0%" on a contract that
 * grew 50%+ — a wrong number stated as fact next to a named company. Spelling the
 * dependency as `RiskMaskRow & …` means a seventh decoder input propagates here
 * automatically instead of failing silently.
 */
export type RiskiestContract = RiskiestContractRow & RiskMaskRow;

// ⚠️ `tag` belongs in filters.columns, NOT in a top-level `fixedFilters` —
// runDbTable's buildWhere reads req.filters.columns only (fixedFilters is the
// FACETS endpoint's shape; DbDataTable merges the two client-side before it
// sends). Sent as fixedFilters it was silently ignored, and 235 contractAmendment
// rows ranked alongside the contracts.
const fetchRiskiest = (
  limit: number,
  window: { from: string | null; to: string | null; all: boolean },
): Promise<RiskiestContract[]> =>
  fetchTablePage<RiskiestContract>({
    resource: "contracts",
    page: 0,
    pageSize: limit,
    sort: [
      { id: "risk_fired", desc: true },
      { id: "risk_cri", desc: true },
    ],
    filters: {
      columns: [
        { id: "tag", value: ["contract"] },
        // Only the elevated tail is worth a leaderboard: D and worse is 3+ fired
        // checks, ~0.84% of the corpus.
        { id: "risk_grade", value: RISKIEST_GRADES },
        ...(!window.all && window.from
          ? [{ id: "date", min: window.from, max: window.to ?? undefined }]
          : []),
      ],
    },
  });

export const useRiskiestContracts = (limit = 8) => {
  const { from, to, all } = useScopeWindow();
  return useQuery({
    // [from, to] alone identifies the window — `from` is null ONLY for the
    // corpus scope (scopeWindowFor gives every ns/y scope a lower bound), so an
    // `all ? …` arm in the key could never distinguish anything. Same shape as
    // the sibling useLatestContracts, deliberately.
    queryKey: ["riskiest-contracts", limit, from, to],
    queryFn: () => fetchRiskiest(limit, { from, to, all }),
    staleTime: Infinity,
    retry: false,
  });
};
