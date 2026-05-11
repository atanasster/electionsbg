import { FC } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { RiskBand } from "@/data/riskScore/useRiskScore";
import { cn } from "@/lib/utils";

// Visual band badge used in the section detail page + risk-score lists.
// Always shown alongside the score band — never the raw integer in a
// headline position — per the UX guidance that the band is the right
// "headline read" and the raw number belongs in the detail.

const BAND_CLASSES: Record<RiskBand, string> = {
  low: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 border-emerald-500/30",
  elevated:
    "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 border-amber-500/30",
  high: "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200 border-orange-500/40",
  critical:
    "bg-red-100 text-red-900 dark:bg-red-950/40 dark:text-red-200 border-red-500/40",
};

const BAND_ICONS: Record<RiskBand, typeof ShieldAlert> = {
  low: ShieldCheck,
  elevated: ShieldQuestion,
  high: ShieldAlert,
  critical: ShieldAlert,
};

export const RiskBandBadge: FC<{
  band: RiskBand;
  score?: number;
  signalsAvailable?: number;
  signalsTotal?: number;
  size?: "sm" | "md";
}> = ({ band, score, signalsAvailable, signalsTotal, size = "md" }) => {
  const { t } = useTranslation();
  const Icon = BAND_ICONS[band];
  const partial =
    signalsAvailable !== undefined &&
    signalsTotal !== undefined &&
    signalsAvailable < signalsTotal;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-medium",
        size === "sm" ? "text-[10px]" : "text-xs",
        BAND_CLASSES[band],
      )}
      title={
        partial
          ? `${t(`risk_band_${band}`)} · ${t("risk_partial_signals_hint")}`
          : t(`risk_band_${band}`)
      }
    >
      <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      <span>{t(`risk_band_${band}`)}</span>
      {score !== undefined && (
        <span className="font-mono tabular-nums opacity-80">
          {Math.round(score)}
        </span>
      )}
      {partial && (
        <span className="font-mono opacity-60">
          · {signalsAvailable}/{signalsTotal}
        </span>
      )}
    </span>
  );
};
