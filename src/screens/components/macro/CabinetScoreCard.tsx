// Per-cabinet score panel — 6 averaged metrics summarising what happened on a
// government's watch. Driven by a single selectedId lifted into the parent
// screen; the host CabinetStrip acts as the selector (click a pill → this
// panel swaps). Default selection is chosen by the host (typically the
// cabinet in office at the user's selected election).
//
// Used on /indicators landing.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import type { Government } from "@/data/governments/useGovernments";
import type { MacroPayload } from "@/data/macro/useMacro";
import {
  cabinetMetricsFor,
  type CabinetMetrics,
} from "@/data/macro/kpiSelectors";
import { colorForGovernmentSolid } from "@/screens/components/governments/governmentColors";
import { cn } from "@/lib/utils";

const fmtPct = (v: number | null): string =>
  v == null ? "—" : `${v >= 0 ? "" : ""}${v.toFixed(1)}%`;

const fmtSignedPp = (v: number | null): string => {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)} pp`;
};

const fmtEurBn = (v: number | null): string => {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}€${v.toFixed(1)}B`;
};

const formatDateShort = (iso: string | null, lang: "bg" | "en"): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    month: "short",
    year: "numeric",
  });
};

type MetricCellProps = {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
};

const MetricCell: FC<MetricCellProps> = ({
  label,
  value,
  tone = "neutral",
}) => {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
        ? "text-rose-600 dark:text-rose-400"
        : "text-foreground";
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-base font-semibold tabular-nums", toneClass)}>
        {value}
      </span>
    </div>
  );
};

const toneFromSignedDelta = (
  v: number | null,
  goodWhenNegative: boolean,
): "positive" | "negative" | "neutral" => {
  if (v == null || v === 0) return "neutral";
  const negativeIsGood = goodWhenNegative;
  if (v < 0) return negativeIsGood ? "positive" : "negative";
  return negativeIsGood ? "negative" : "positive";
};

export const CabinetScoreDetail: FC<{
  government: Government;
  macro: MacroPayload;
  className?: string;
}> = ({ government: g, macro, className }) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const { colorFor } = useCanonicalParties();
  const metrics: CabinetMetrics = useMemo(
    () => cabinetMetricsFor(g, macro),
    [g, macro],
  );

  const fullName = lang === "bg" ? g.pmBg : g.pmEn;
  const parties = lang === "bg" ? g.parties : (g.partiesEn ?? g.parties);
  const tenure = `${formatDateShort(g.startDate, lang)} – ${formatDateShort(g.endDate, lang)}`;
  const ribbon = colorForGovernmentSolid(g, colorFor);
  const caretaker = g.type === "caretaker";

  const debtTone = toneFromSignedDelta(metrics.debtChangePpGdp, true);
  const balanceTone = toneFromSignedDelta(metrics.avgBudgetBalancePpGdp, false);
  const netFundsTone = toneFromSignedDelta(metrics.netEuFundsEurBn, false);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card shadow-sm overflow-hidden",
        className,
      )}
    >
      <div className="flex">
        <div
          className="w-1.5 shrink-0"
          style={{ backgroundColor: ribbon }}
          aria-hidden
        />
        <div className="flex-1 p-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold">{fullName}</span>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {caretaker ? t("gov_type_caretaker") : t("gov_type_regular")}
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {tenure}
            </span>
            {parties.length > 0 && (
              <span className="text-[11px] text-muted-foreground truncate">
                {parties.join(", ")}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-3">
            <MetricCell
              label={t("cabinet_card_gdp")}
              value={fmtPct(metrics.avgGdpGrowth)}
            />
            <MetricCell
              label={t("cabinet_card_inflation")}
              value={fmtPct(metrics.avgInflation)}
            />
            <MetricCell
              label={t("cabinet_card_unemployment")}
              value={fmtPct(metrics.avgUnemployment)}
            />
            <MetricCell
              label={t("cabinet_card_debt_change")}
              value={fmtSignedPp(metrics.debtChangePpGdp)}
              tone={debtTone}
            />
            <MetricCell
              label={t("cabinet_card_balance")}
              value={fmtPct(metrics.avgBudgetBalancePpGdp)}
              tone={balanceTone}
            />
            <MetricCell
              label={t("cabinet_card_eu_net")}
              value={fmtEurBn(metrics.netEuFundsEurBn)}
              tone={netFundsTone}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
