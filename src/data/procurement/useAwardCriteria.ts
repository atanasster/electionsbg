// Award-criterion mix (ЗОП чл. 70), DB-backed
// (/api/db/procurement-award-criteria → procurement_award_criteria), scoped to
// the selected parliament window / year or the full corpus (?pscope).
//
// This is the BID-EVALUATION rule recorded at award time — never a
// payment-for-outcome signal. See docs/plans/procurement-outcomes-v1.md §0a.

import { useQuery } from "@tanstack/react-query";
import { useScopeWindow } from "@/data/scope/useScopeWindow";

/** The criterion buckets the server can emit, in legend/draw order.
 *
 *  ONE home on purpose: the tile draws these and `award_criteria.data.test.ts`
 *  asserts the SQL emits exactly this set. A seventh bucket added server-side
 *  would otherwise be counted in `total` but never drawn, so every bar would
 *  silently render short — arithmetically wrong with nothing on screen to show it.
 */
export const AWARD_CRITERION_BUCKETS = [
  "meat",
  "lcc",
  "combined",
  "price",
  "other",
  "unknown",
] as const;

export type AwardCriterionBucket = (typeof AWARD_CRITERION_BUCKETS)[number];

/** One year's or one contract-type's criterion split. Counts are tenders. */
export type AwardCriteriaRow = {
  /** Present on byYear rows. */
  year?: string;
  /** Present on byType rows: goods | services | works | unspecified. */
  contractType?: string;
  total: number;
  price: number;
  meat: number;
  lcc: number;
  combined: number;
  /** A non-null criterion string the server did not recognise. Expected 0. */
  other: number;
  /** Criterion NOT STATED — kept visible, never redistributed (plan §1b). */
  unknown: number;
  /** FORECAST value (прогнозна стойност), never spend. byYear only. */
  estimatedEur?: number;
};

export type AwardCriteriaFile = {
  /** The year the ЦАИС award_method field begins; byYear is floored here. */
  firstYear: string;
  coverage: {
    total: number;
    competitive: number;
    noCall: number;
    /** Competitive tenders dropped by the firstYear floor. */
    preCriterionTenders: number;
  };
  byYear: AwardCriteriaRow[];
  byType: AwardCriteriaRow[];
};

export const useAwardCriteria = (enabled = true) => {
  const { from, to } = useScopeWindow();
  return useQuery({
    enabled,
    queryKey: ["procurement", "award-criteria", from, to],
    queryFn: async (): Promise<AwardCriteriaFile | null> => {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await fetch(
        `/api/db/procurement-award-criteria?${qs.toString()}`,
      );
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      // null when migration 164 has not reached this database — the tile
      // self-suppresses rather than rendering an empty chart.
      return (await r.json()) as AwardCriteriaFile | null;
    },
    staleTime: Infinity,
  });
};
