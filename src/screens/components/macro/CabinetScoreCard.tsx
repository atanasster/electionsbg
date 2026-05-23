// Per-cabinet score card — 6 averaged metrics summarising what happened on a
// government's watch. Rendered in a horizontally-scrolling row that mirrors
// the CabinetStrip order: hover a strip pill, the matching card highlights
// (and vice versa) via a shared hover-id lifted into the parent screen.
//
// Used on /indicators landing and /governments. The companion CabinetScoreRow
// owns the loop + lifted hover state.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import type { Government } from "@/data/governments/useGovernments";
import type { MacroPayload } from "@/data/macro/useMacro";
import {
  cabinetMetricsForAll,
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
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-xs font-semibold tabular-nums", toneClass)}>
        {value}
      </span>
    </div>
  );
};

type CardProps = {
  government: Government;
  metrics: CabinetMetrics;
  highlighted?: boolean;
  onHoverChange?: (id: string | null) => void;
  lang: "bg" | "en";
};

const Card: FC<CardProps> = ({
  government: g,
  metrics,
  highlighted,
  onHoverChange,
  lang,
}) => {
  const { t } = useTranslation();
  const { colorFor } = useCanonicalParties();
  const surname = (lang === "bg" ? g.pmBg : g.pmEn).split(" ").pop() ?? "";
  const tenure = `${formatDateShort(g.startDate, lang)} – ${formatDateShort(g.endDate, lang)}`;
  const ribbon = colorForGovernmentSolid(g, colorFor);
  const caretaker = g.type === "caretaker";

  const debtTone: "positive" | "negative" | "neutral" =
    metrics.debtChangePpGdp == null
      ? "neutral"
      : metrics.debtChangePpGdp > 0
        ? "negative"
        : metrics.debtChangePpGdp < 0
          ? "positive"
          : "neutral";

  const balanceTone: "positive" | "negative" | "neutral" =
    metrics.avgBudgetBalancePpGdp == null
      ? "neutral"
      : metrics.avgBudgetBalancePpGdp >= 0
        ? "positive"
        : "negative";

  const netFundsTone: "positive" | "negative" | "neutral" =
    metrics.netEuFundsEurBn == null
      ? "neutral"
      : metrics.netEuFundsEurBn >= 0
        ? "positive"
        : "negative";

  return (
    <div
      className={cn(
        "shrink-0 w-[200px] rounded-lg border bg-card p-2 shadow-sm transition-colors",
        highlighted ? "border-primary ring-1 ring-primary/40" : "border-border",
        caretaker ? "opacity-80" : "",
      )}
      onMouseEnter={() => onHoverChange?.(g.id)}
      onMouseLeave={() => onHoverChange?.(null)}
      onFocus={() => onHoverChange?.(g.id)}
      onBlur={() => onHoverChange?.(null)}
      tabIndex={0}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="inline-block h-3 w-1 rounded-sm"
          style={{ backgroundColor: ribbon }}
          aria-hidden
        />
        <span
          className="text-xs font-semibold truncate"
          title={lang === "bg" ? g.pmBg : g.pmEn}
        >
          {surname}
        </span>
        {caretaker && (
          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
            {t("gov_type_caretaker")}
          </span>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums mb-2">
        {tenure}
      </div>
      <div className="grid grid-cols-3 gap-x-2 gap-y-1.5">
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
  );
};

export const CabinetScoreRow: FC<{
  governments: Government[];
  macro: MacroPayload;
  hoveredId?: string | null;
  onHoverChange?: (id: string | null) => void;
  className?: string;
}> = ({ governments, macro, hoveredId, onHoverChange, className }) => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const metricsList = useMemo(
    () => cabinetMetricsForAll(governments, macro),
    [governments, macro],
  );
  const byId = useMemo(() => {
    const m = new Map<string, CabinetMetrics>();
    for (const x of metricsList) m.set(x.govId, x);
    return m;
  }, [metricsList]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {t("cabinet_score_row_heading")}
      </div>
      <div
        className="flex gap-2 overflow-x-auto pb-2"
        role="list"
        aria-label={t("cabinet_score_row_heading")}
      >
        {governments.map((g) => {
          const metrics = byId.get(g.id);
          if (!metrics) return null;
          return (
            <div role="listitem" key={g.id}>
              <Card
                government={g}
                metrics={metrics}
                highlighted={hoveredId === g.id}
                onHoverChange={onHoverChange}
                lang={lang}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
