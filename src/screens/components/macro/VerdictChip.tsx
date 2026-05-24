// Tiny "is this good?" chip rendered next to every KpiTile headline. Three
// states: good (green dot + "по-добре от ЕС"), neutral (slate dot + "близо до
// средното"), concern (red dot + "под средното"). Verdict is auto-derived —
// no editorial content needed for v1 — using:
//   1. EU27 rank percentile when the indicator has peer data (top third =
//      good, bottom third = concern, else neutral)
//   2. Otherwise, YoY direction relative to whether higher/lower is better
//      for the indicator (significant moves only — small wiggles stay
//      neutral)
//
// Indicators with `direction: "none"` (e.g. current account, house prices
// YoY) get no chip at all because the polarity is ambiguous.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
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

const TONE_CLASS: Record<Exclude<Verdict, "none">, string> = {
  good: "bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  neutral: "bg-muted/40 text-muted-foreground border-border/60",
  concern:
    "bg-rose-500/[0.12] text-rose-700 dark:text-rose-300 border-rose-500/30",
};

const DOT_CLASS: Record<Exclude<Verdict, "none">, string> = {
  good: "bg-emerald-500",
  neutral: "bg-muted-foreground/40",
  concern: "bg-rose-500",
};

export const VerdictChip: FC<{ verdict: Verdict; className?: string }> = ({
  verdict,
  className,
}) => {
  const { t } = useTranslation();
  if (verdict === "none") return null;
  const label =
    verdict === "good"
      ? t("kpi_verdict_good")
      : verdict === "concern"
        ? t("kpi_verdict_concern")
        : t("kpi_verdict_neutral");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        TONE_CLASS[verdict],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 rounded-full", DOT_CLASS[verdict])}
      />
      {label}
    </span>
  );
};
