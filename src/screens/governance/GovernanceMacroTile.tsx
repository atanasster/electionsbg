// Lightweight summary of the latest macro + governance indicators on the
// Governance dashboard's macro section. Pulls a small set of Eurostat /
// World Bank tail values from data/macro.json and shows them in a card
// grid with sparkline-free formatting; deep-dive views live under
// /governments (cabinet timeline) and existing macro charts.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@/ux/Link";
import { ArrowRight } from "lucide-react";
import { useMacro, type MacroIndicatorKey } from "@/data/macro/useMacro";
import { StatCard } from "@/screens/dashboard/StatCard";
import { localDate } from "@/data/utils";

// localDate expects YYYY_MM_DD; the macro file's `fetchedAt` is ISO.
const fmtIsoDate = (iso: string): string => {
  const date = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return iso;
  return localDate(date.replace(/-/g, "_"));
};

// Curated rotation of indicators that fit the "governance context" frame —
// fiscal headroom, social outcomes, governance scores. Each one comes
// straight from useMacro.
const KEYS: MacroIndicatorKey[] = [
  "gdpGrowth",
  "govDebt",
  "budgetBalance",
  "wgiRuleOfLaw",
  "wgiControlOfCorruption",
  "gini",
];

const fmt = (value: number, decimals = 1): string =>
  Number.isFinite(value) ? value.toFixed(decimals) : "—";

export const GovernanceMacroTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { data: macro } = useMacro();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";

  if (!macro) return null;

  const cards = KEYS.map((key) => {
    const series = macro.series[key] ?? [];
    const meta = macro.indicators[key];
    if (!meta || series.length === 0) return null;
    const latest = series[series.length - 1];
    const prior = series.length >= 2 ? series[series.length - 2] : undefined;
    const delta = prior ? latest.value - prior.value : null;
    const title = lang === "bg" ? meta.titleBg : meta.titleEn;
    const unit = lang === "bg" ? meta.unitLabelBg : meta.unitLabelEn;
    const period = latest.period ?? `${latest.year}`;
    const arrow = delta == null ? "" : delta > 0 ? "▲" : delta < 0 ? "▼" : "·";
    const deltaText =
      delta == null
        ? ""
        : `${arrow} ${fmt(Math.abs(delta), 2)} ${t("governance_macro_vs_prior") || "vs prior"}`;
    return (
      <StatCard key={key} label={<span className="truncate">{title}</span>}>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold tabular-nums">
            {fmt(latest.value, 2)}
          </span>
          <span className="text-xs text-muted-foreground">{unit}</span>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {period}
        </div>
        {delta != null && (
          <div className="text-xs text-muted-foreground tabular-nums">
            {deltaText}
          </div>
        )}
      </StatCard>
    );
  }).filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {cards}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t("governance_macro_source") || "Eurostat & World Bank WGI"} ·{" "}
          {macro.fetchedAt
            ? `${t("governance_as_of") || "as of"} ${fmtIsoDate(macro.fetchedAt)}`
            : ""}
        </span>
        <Link
          to="/governments"
          underline={false}
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          {t("governance_macro_link") || "Cabinet timeline"}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
};
