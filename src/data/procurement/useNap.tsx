// Data hook for the НАП (National Revenue Agency) revenue pack. Revenue-first:
// the by-tax-type composition is a pure selector over the EXISTING useKfp()
// (kfp.json snapshots), NOT a new fetch. The КИД-2008 by-sector VAT drill is the
// 2024-only useVatBreakdown. No contract corpus (the ЗОП buy-side is on the
// generic awarder page below).

import { useMemo } from "react";
import { useKfp, useVatBreakdown } from "@/data/budget/useBudget";
import {
  TAX_TYPES,
  TAX_REVENUE_GROUP,
  type TaxTypeId,
} from "@/lib/napReferenceData";
import type { KfpSnapshot, VatBreakdownFile } from "@/data/budget/types";

export interface TaxSegment {
  id: TaxTypeId;
  eur: number;
}

export interface NapComposition {
  year: number;
  asOf: string;
  /** true when the snapshot is not a full-year (period not YYYY-12) — label it,
   *  never annualize it, and exclude it from YoY. */
  partial: boolean;
  totalTaxEur: number;
  segments: TaxSegment[];
}

// Pure: fold one КФП snapshot's revenue section into the ordered tax-type
// composition. Picks the leaf lines under the "Данъчни приходи" group and
// buckets each by its label; unmatched tax leaves fold into "other".
export const buildComposition = (snap: KfpSnapshot): NapComposition | null => {
  const revenue = snap.sections.find((s) => s.series === "revenue");
  if (!revenue) return null;
  const leaves = revenue.lines.filter(
    (l) =>
      !l.isSubtotal &&
      l.executed != null &&
      (l.groupLabelBg ?? "").match(TAX_REVENUE_GROUP),
  );
  if (leaves.length === 0) return null;

  const sums = new Map<TaxTypeId, number>();
  for (const leaf of leaves) {
    const eur = leaf.executed?.amountEur ?? 0;
    if (eur <= 0) continue;
    const t = TAX_TYPES.find((x) => leaf.labelBg.match(x.match));
    const id: TaxTypeId = t?.id ?? "other";
    sums.set(id, (sums.get(id) ?? 0) + eur);
  }
  // Ordered: TAX_TYPES order first, then "other".
  const segments: TaxSegment[] = [
    ...TAX_TYPES.map((t) => ({ id: t.id, eur: sums.get(t.id) ?? 0 })),
    { id: "other" as TaxTypeId, eur: sums.get("other") ?? 0 },
  ].filter((s) => s.eur > 0);

  const totalTaxEur = segments.reduce((a, s) => a + s.eur, 0);
  if (totalTaxEur <= 0) return null;

  return {
    year: snap.fiscalYear,
    asOf: snap.asOf,
    partial: !/-12$/.test(snap.period),
    totalTaxEur,
    segments,
  };
};

export interface NapData {
  /** Newest-first years that carry a tax composition. */
  compositions: NapComposition[];
  vat: VatBreakdownFile | null;
  isLoading: boolean;
}

export const useNap = (): NapData => {
  const kfp = useKfp();
  const vat = useVatBreakdown(2024);

  const compositions = useMemo(() => {
    const snaps = kfp.data?.snapshots ?? [];
    // Newest year first; within a year the latest asOf first. Then keep one
    // composition per fiscal year (the newest) — KFP may emit both a mid-year
    // and an annual snapshot for the same year, which would otherwise produce
    // duplicate picker keys and an unselectable second button.
    const sorted = snaps
      .map(buildComposition)
      .filter((c): c is NapComposition => c != null)
      .sort((a, b) => b.year - a.year || b.asOf.localeCompare(a.asOf));
    const seen = new Set<number>();
    return sorted.filter((c) => {
      if (seen.has(c.year)) return false;
      seen.add(c.year);
      return true;
    });
  }, [kfp.data]);

  return {
    compositions,
    vat: vat.data ?? null,
    isLoading: kfp.isLoading || vat.isLoading,
  };
};
