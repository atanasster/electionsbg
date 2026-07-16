// "Кошница vs официална инфлация" — the national Consumption tile that puts the
// КЗП monitoring basket (cumulative change since the euro) next to the official
// Eurostat HICP (year-on-year, with the food/energy/core breakdown). Answers
// "is the staples basket tracking official inflation?" without claiming the two
// are the same measure — they cover different windows and methodologies, which
// the note spells out. National only (HICP has no sub-national grain).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PriceIndexTrendChart } from "@/screens/components/prices/PriceIndexTrendChart";
import {
  usePriceIndex,
  fmtPct,
  fmtPriceDate,
  priceChangeColor as changeColor,
} from "@/data/prices/usePrices";
import { useMacro, type MacroPoint } from "@/data/macro/useMacro";

const latest = (pts?: MacroPoint[]): MacroPoint | undefined =>
  pts && pts.length ? pts[pts.length - 1] : undefined;

const periodLabel = (p?: MacroPoint): string =>
  p ? (p.quarter ? `${p.year} Q${p.quarter}` : `${p.year}`) : "";

export const ConsumptionInflationTile: FC = () => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const { data: index } = usePriceIndex();
  const { data: macro } = useMacro();

  if (!index || !macro) return null;
  const series = index.national.index;
  if (series.length < 2) return null;

  const basketChange = series[series.length - 1].v / 100 - 1;
  const baselineLabel = fmtPriceDate(index.firstDate || index.baseline, lang);

  const overall = latest(macro.series.inflation);
  const food = latest(macro.series.inflationFood);
  const energy = latest(macro.series.inflationEnergy);
  const core = latest(macro.series.inflationCore);
  const period = periodLabel(overall ?? food);
  const eurostatUrl =
    macro.indicators?.inflationFood?.sourceUrl ??
    macro.indicators?.inflation?.sourceUrl;

  // Food first — the КЗП basket is staple-food-heavy, so HICP food is the most
  // apt official comparison; overall / energy / core add texture.
  const rows = [
    { label: T("Храни", "Food"), p: food },
    { label: T("Обща", "Overall"), p: overall },
    { label: T("Енергия", "Energy"), p: energy },
    { label: T("Базова", "Core"), p: core },
  ].filter((r): r is { label: string; p: MacroPoint } => !!r.p);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {/* КЗП monitoring basket — cumulative since the euro */}
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {T("Кошница на КЗП (мониторинг)", "CPC basket (monitoring)")}
          </div>
          <div
            className={`text-2xl font-bold tabular-nums ${changeColor(basketChange)}`}
          >
            {fmtPct(basketChange)}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {T("от", "since")} {baselineLabel}
          </div>
        </div>

        {/* Official HICP — year-on-year, latest quarter */}
        <div className="rounded-lg border p-3">
          <div className="text-xs text-muted-foreground mb-1">
            {T("Официална инфлация · ХИПЦ", "Official inflation · HICP")}
            {period ? ` · ${period}` : ""}
          </div>
          <ul className="space-y-0.5 text-sm">
            {rows.map((r) => (
              <li key={r.label} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{r.label}</span>
                <span
                  className={`tabular-nums font-medium ${changeColor(r.p.value / 100)}`}
                >
                  {fmtPct(r.p.value / 100)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Basket path since the euro — a clean trend, not a per-day squiggle. */}
      <div>
        <div className="text-xs text-muted-foreground mb-1">
          {T(
            "Кошница на КЗП във времето (индекс, база 100)",
            "CPC basket over time (index, base 100)",
          )}
        </div>
        <PriceIndexTrendChart series={series} />
      </div>

      <p className="text-xs text-muted-foreground">
        {T(
          "Кошницата е кумулативен мониторингов индекс на КЗП от въвеждането на еврото; ХИПЦ е официалният годишен темп на инфлация (Евростат). Различни прозорци и методология — не са пряко съпоставими.",
          "The basket is a cumulative CPC monitoring index since the euro changeover; HICP is the official year-on-year inflation rate (Eurostat). Different windows and methodology — not directly comparable.",
        )}
      </p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {eurostatUrl ? (
          <a
            href={eurostatUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            {T("Източник: Евростат (ХИПЦ)", "Source: Eurostat (HICP)")}
          </a>
        ) : null}
        <a
          href={index.source.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          kolkostruva.bg
        </a>
      </div>
    </div>
  );
};
