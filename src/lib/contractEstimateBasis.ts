import type { ProcurementContract } from "@/data/dataTypes";

/** A value-vs-baseline delta as a percentage. Below 0.05% toFixed(1) prints
 *  „0.0%", which reads as „exactly the estimate", so those print „<0.1%".
 *  `signed` adds the +/− (an ASCII hyphen-minus in both branches). */
export const formatDeltaPct = (deltaPct: number, signed: boolean): string => {
  const abs = Math.abs(deltaPct);
  const sign = !signed ? "" : deltaPct >= 0 ? "+" : "-";
  return abs < 0.05 ? `${sign}<0.1%` : `${sign}${abs.toFixed(1)}%`;
};

// Which estimate a signed contract is compared against. A lot of a multi-lot
// procedure gets its OWN lot's estimate, or none when the lot cannot be matched —
// never the whole procedure's, which made one lot look half price.
export const contractEstimateBasis = (
  c: Pick<
    ProcurementContract,
    "lotsCount" | "lotEstimatedValueEur" | "estimatedValueEur"
  >,
): { estimated: number | null; multiLot: boolean } => {
  const multiLot = (c.lotsCount ?? 0) > 1;
  return {
    multiLot,
    estimated: multiLot
      ? (c.lotEstimatedValueEur ?? null)
      : (c.estimatedValueEur ?? null),
  };
};
