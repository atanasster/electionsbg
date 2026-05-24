// Tiny "is this good?" chip rendered next to every KpiTile headline. Three
// states: good (green dot + "по-добре от ЕС"), neutral (slate dot + "близо до
// средното"), concern (red dot + "под средното"). See verdict.ts for the
// derivation logic.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { Verdict } from "./verdict";

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
