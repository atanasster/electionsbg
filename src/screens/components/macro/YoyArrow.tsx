// Year-on-year delta with a coloured arrow. Green when the change moves in
// the "good" direction for this indicator, red when it moves the other way,
// neutral when direction is unspecified or the change is effectively zero.
//
// Used on the /indicators KPI tiles. Existing tiles (GovernanceMacroTile,
// dashboard IndicatorsTile) keep their own renderers — this component is the
// shared primitive going forward.

import { FC } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type YoyArrowProps = {
  /** Signed delta (latest - prior) in the indicator's own units. */
  delta: number | null | undefined;
  /** "lower" = lower-is-better, "higher" = higher-is-better, "none" = no
   *  colouring (current account, house prices YoY). */
  direction: "lower" | "higher" | "none";
  /** Custom formatter for the magnitude. Receives the absolute value of the
   *  delta; the component prepends the sign and the icon. Use this when the
   *  headline value converts units (e.g. EUR million → EUR billion). */
  formatMagnitude?: (absDelta: number) => string;
  /** Suffix appended to the formatted delta when `formatMagnitude` is not set.
   *  "pp" for percentage-point changes on rate indicators, "%" for percent
   *  change on level indicators, "" when the value is unitless. */
  suffix?: "pp" | "%" | "";
  /** Decimal places on the delta when `formatMagnitude` is not set. Default 1. */
  decimals?: number;
  className?: string;
};

// Below this absolute delta we treat the change as a wash — keeps the arrow
// from flipping green/red on noise within rounding distance of zero.
const ZERO_EPSILON = 0.05;

export const YoyArrow: FC<YoyArrowProps> = ({
  delta,
  direction,
  formatMagnitude,
  suffix = "",
  decimals = 1,
  className,
}) => {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }
  const positive = delta > 0;
  const absRounded = Math.abs(
    Math.round(delta * Math.pow(10, decimals)) / Math.pow(10, decimals),
  );
  const isZero = absRounded < ZERO_EPSILON;
  const Icon = isZero ? Minus : positive ? TrendingUp : TrendingDown;
  const goodMove =
    isZero || direction === "none"
      ? null
      : (positive && direction === "higher") ||
        (!positive && direction === "lower");
  const tone =
    goodMove === null
      ? "text-muted-foreground"
      : goodMove
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-rose-600 dark:text-rose-400";
  const sign = isZero ? "" : positive ? "+" : "−";
  const magnitude = formatMagnitude
    ? formatMagnitude(absRounded)
    : `${absRounded.toFixed(decimals)}${suffix ? ` ${suffix}` : ""}`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 tabular-nums",
        tone,
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {sign}
      {magnitude}
    </span>
  );
};
