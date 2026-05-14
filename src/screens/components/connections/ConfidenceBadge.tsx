// Compact "name match only" / "corroborated" badge for MP↔company links.
//
// Used wherever the SPA surfaces a TR-derived role or a procurement row that
// rests on one. The link confidence comes from scripts/declarations/tr/integrate.ts
// (high if the TR seat covers the MP region or a same-party MP also declared
// the company; medium if it's a name match only) and is propagated through
// companies-index.json / mp_connected.json / procurement by_ns aggregates.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";

export const ConfidenceBadge: FC<{
  confidence: "high" | "medium";
  reason?: string;
  showHigh?: boolean;
}> = ({ confidence, reason, showHigh = true }) => {
  const { t } = useTranslation();
  if (confidence === "high" && !showHigh) return null;
  const isHigh = confidence === "high";
  const label = isHigh
    ? t("tr_confidence_high") || "high"
    : t("tr_confidence_medium") || "medium";
  const tooltip =
    reason ??
    (isHigh
      ? t("tr_confidence_high_tooltip") ||
        "Corroborated by declaration, region or party-witness match."
      : t("tr_confidence_medium_tooltip") ||
        "Name match only — the MP shares a name with a TR officer of this company but no further corroborating signal was found.");
  return (
    <span
      title={tooltip}
      className={
        isHigh
          ? "inline-flex items-center gap-1 rounded px-1 py-px text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
          : "inline-flex items-center gap-1 rounded px-1 py-px text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
      }
    >
      <ShieldCheck className="h-2.5 w-2.5" />
      {label}
    </span>
  );
};
