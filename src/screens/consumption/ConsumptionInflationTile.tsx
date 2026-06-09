// "Кошница vs официална инфлация" — the national Consumption tile that puts the
// КЗП monitoring basket (cumulative change since the euro) next to the official
// Eurostat HICP (year-on-year, with the food/energy/core breakdown). Answers
// "is the staples basket tracking official inflation?" without claiming the two
// are the same measure — they cover different windows and methodologies, which
// the note spells out. National only (HICP has no sub-national grain).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PriceSparkline } from "@/screens/components/prices/PriceSparkline";
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

  // National house-price index (Eurostat HPI) — a housing cost-of-living signal
  // alongside the consumer-price picture. Per-oblast HPI lives only in NSI's
  // Cloudflare-walled Infostat DB, so this national line is the clean stand-in.
  const housePrices = latest(macro.series.housePricesYoY);

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
          <div className="flex items-end justify-between gap-2">
            <div>
              <div
                className={`text-2xl font-bold tabular-nums ${changeColor(basketChange)}`}
              >
                {fmtPct(basketChange)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {T("от", "since")} {baselineLabel}
              </div>
            </div>
            <PriceSparkline points={series} width={150} height={40} />
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

      {housePrices ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
          <span className="text-muted-foreground">
            {T("Цени на жилищата · YoY", "House prices · YoY")}
            {periodLabel(housePrices) ? ` · ${periodLabel(housePrices)}` : ""}
          </span>
          <span
            className={`tabular-nums font-semibold ${changeColor(housePrices.value / 100)}`}
          >
            {fmtPct(housePrices.value / 100)}
          </span>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {T(
          "Кошницата е кумулативен мониторингов индекс на КЗП от въвеждането на еврото; ХИПЦ е официалният годишен темп на инфлация (Евростат). Цените на жилищата са национален индекс (Евростат); различни прозорци и методология — не са пряко съпоставими.",
          "The basket is a cumulative CPC monitoring index since the euro changeover; HICP is the official year-on-year inflation rate (Eurostat). House prices are a national index (Eurostat); different windows and methodology — not directly comparable.",
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
