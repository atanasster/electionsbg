// Small "rank N/27" pill used wherever a Bulgarian indicator is positioned
// against the EU27 distribution — peer snapshot strip, peer snapshot table,
// and the KPI tiles on /indicators. Extracted so the visual stays consistent
// when one is restyled.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export const RankBadge: FC<{
  rank: number;
  total: number;
  /** "lower" = lower-is-better (inflation, debt). "higher" = higher-is-better
   *  (GDP growth, balance). Drives the tooltip text only — the badge itself
   *  is neutral so it sits comfortably next to numbers of either polarity. */
  direction: "lower" | "higher";
  className?: string;
  /** Optional label override; defaults to localized "rank" / "позиция". */
  label?: string;
}> = ({ rank, total, direction, className, label }) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const tooltip =
    lang === "bg"
      ? direction === "lower"
        ? "позиция 1 = най-ниската стойност (по-ниско е по-добре)"
        : "позиция 1 = най-високата стойност (по-високо е по-добре)"
      : direction === "lower"
        ? "rank 1 = lowest value (lower is better)"
        : "rank 1 = highest value (higher is better)";
  const resolvedLabel = label ?? (lang === "bg" ? "позиция" : "rank");
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded-full bg-muted/40 text-foreground",
        className,
      )}
      title={tooltip}
    >
      {resolvedLabel ? <span className="mr-0.5">{resolvedLabel}</span> : null}
      <span className="font-semibold tabular-nums">
        {rank}/{total}
      </span>
    </span>
  );
};
