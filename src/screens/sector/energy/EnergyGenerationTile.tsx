// Physics tile for /sector/energy — the generation mix, net trade and carbon
// intensity that the procurement corpus can't show. This is the differentiator
// no BG money-transparency site has: nuclear-heavy mix, a persistent NET
// EXPORTER, and a decarbonising CO2 path. Full-history (scope-independent).
// Data: Ember Yearly Electricity Data (CC BY 4.0) via useEnergyGeneration.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useEnergyGeneration } from "@/data/energy/useEnergyGeneration";

// Fixed colour + label per fuel (mid-lightness, reads on cream + navy). Order is
// fixed (never repaint by magnitude): the eye learns "nuclear is amber".
const FUELS: { key: string; bg: string; en: string; color: string }[] = [
  { key: "nuclear", bg: "Ядрена", en: "Nuclear", color: "#b07d2f" },
  { key: "coal", bg: "Въглища", en: "Coal", color: "#6b5544" },
  { key: "gas", bg: "Газ", en: "Gas", color: "#c9702f" },
  { key: "hydro", bg: "ВЕЦ", en: "Hydro", color: "#3f6a8a" },
  { key: "solar", bg: "Слънчева", en: "Solar", color: "#d9a441" },
  { key: "wind", bg: "Вятърна", en: "Wind", color: "#4a9b8f" },
  { key: "bioenergy", bg: "Биомаса", en: "Bioenergy", color: "#6e845d" },
  { key: "otherFossil", bg: "Друго изкопаемо", en: "Other fossil", color: "#8a8f98" }, // prettier-ignore
  { key: "otherRenewables", bg: "Друго ВЕИ", en: "Other renewables", color: "#9c8636" }, // prettier-ignore
];

const fmt = (v: number | null, digits = 1): string =>
  v == null ? "—" : v.toFixed(digits);

export const EnergyGenerationTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useEnergyGeneration();
  if (!data) return null;

  const y = data.years[data.years.length - 1];
  const segs = FUELS.map((f) => ({ ...f, twh: y.byFuel[f.key] ?? 0 })).filter(
    (s) => s.twh > 0,
  );
  const sum = segs.reduce((a, s) => a + s.twh, 0) || 1;
  const net = y.netImports ?? 0;
  const exporter = net < 0;

  return (
    <Card className="md:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg
            ? `Производство на ток (${y.year})`
            : `Electricity generation (${y.year})`}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        {/* stacked fuel-mix bar */}
        <div className="flex h-5 w-full overflow-hidden rounded">
          {segs.map((s) => (
            <div
              key={s.key}
              style={{
                width: `${(s.twh / sum) * 100}%`,
                backgroundColor: s.color,
              }}
              title={`${bg ? s.bg : s.en}: ${fmt(s.twh)} TWh (${Math.round((s.twh / sum) * 100)}%)`}
            />
          ))}
        </div>
        {/* legend */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {segs.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: s.color }}
              />
              <span>{bg ? s.bg : s.en}</span>
              <span className="tabular-nums text-muted-foreground">
                {Math.round((s.twh / sum) * 100)}%
              </span>
            </span>
          ))}
        </div>
        {/* headline stats */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {fmt(y.totalGen)} TWh
            </div>
            <div className="text-xs text-muted-foreground">
              {bg ? "Общо производство" : "Total generation"}
            </div>
          </div>
          <div>
            <div
              className="text-lg font-semibold tabular-nums"
              style={{ color: exporter ? "#3a7a5e" : "#c14b57" }}
            >
              {fmt(Math.abs(net))} TWh
            </div>
            <div className="text-xs text-muted-foreground">
              {exporter
                ? bg
                  ? "Нетен износ на ток"
                  : "Net electricity export"
                : bg
                  ? "Нетен внос на ток"
                  : "Net electricity import"}
            </div>
          </div>
          <div>
            <div className="text-lg font-semibold tabular-nums">
              {fmt(y.co2Intensity, 0)}
            </div>
            <div className="text-xs text-muted-foreground">
              {bg ? "гCO₂/kWh интензитет" : "gCO₂/kWh intensity"}
            </div>
          </div>
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          {bg ? "Източник: " : "Source: "}
          Ember — Yearly Electricity Data (CC BY 4.0)
        </div>
      </CardContent>
    </Card>
  );
};
