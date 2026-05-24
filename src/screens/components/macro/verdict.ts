// Verdict derivation for KPI tiles. See VerdictChip.tsx for the chip itself.
// Three states + "none" (= no chip): good / neutral / concern. Derived from
// EU27 rank percentile when available, else YoY direction relative to whether
// higher or lower is better for the indicator.

import type { IndicatorDirection } from "@/screens/indicators/indicatorsRegistry";

export type Verdict = "good" | "neutral" | "concern" | "none";

type RankInfo = { rank: number; total: number };

type Args = {
  direction: IndicatorDirection;
  rank: RankInfo | null;
  /** YoY change in the indicator's native units (pp for rates, level for
   *  indices). null = unavailable (e.g. series too short). */
  yoyDelta: number | null;
  /** Threshold above which a YoY move counts as "significant". Defaults to
   *  0.5 (a half-percentage-point shift on a rate indicator). The registry
   *  could be extended per-indicator if needed. */
  significantDelta?: number;
};

export const deriveVerdict = ({
  direction,
  rank,
  yoyDelta,
  significantDelta = 0.5,
}: Args): Verdict => {
  if (direction === "none") return "none";

  if (rank) {
    const percentile = rank.rank / rank.total;
    // Rank 1 = best position (the RankBadge convention). Top third = good,
    // bottom third = concern, middle = neutral. "neutral" with rank evidence
    // is a legitimate verdict — the indicator IS sitting near the EU median.
    if (percentile <= 1 / 3) return "good";
    if (percentile >= 2 / 3) return "concern";
    return "neutral";
  }

  // No rank → fall back to YoY direction, but only when we actually have a
  // YoY value. Without rank AND without YoY we have zero evidence — return
  // "none" rather than the misleading "near average" chip.
  if (yoyDelta == null) return "none";
  if (Math.abs(yoyDelta) < significantDelta) return "neutral";
  const improving = yoyDelta < 0 === (direction === "lower");
  return improving ? "good" : "concern";
};
