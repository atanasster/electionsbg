// Physics tile for /sector/energy — the generation mix, net trade and carbon
// intensity that the procurement corpus can't show. This is the differentiator
// no BG money-transparency site has: nuclear-heavy mix, a persistent NET
// EXPORTER, and a decarbonising CO2 path. Full-history (scope-independent).
// Data: Ember Yearly Electricity Data (CC BY 4.0) via useEnergyGeneration.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useEnergyGeneration } from "@/data/energy/useEnergyGeneration";
import { ENERGY_FUELS } from "@/data/energy/types";

// Fixed colour per fuel (mid-lightness, reads on cream + navy). The key/label
// list is the shared ENERGY_FUELS (src/data/energy/types) — extended here with a
// colour. Order is fixed (never repaint by magnitude): the eye learns "nuclear
// is amber".
const FUEL_COLOR: Record<string, string> = {
  nuclear: "#b07d2f",
  coal: "#6b5544",
  gas: "#c9702f",
  hydro: "#3f6a8a",
  solar: "#d9a441",
  wind: "#4a9b8f",
  bioenergy: "#6e845d",
  otherFossil: "#8a8f98",
  otherRenewables: "#9c8636",
};
const FUELS = ENERGY_FUELS.map((f) => ({
  ...f,
  color: FUEL_COLOR[f.key] ?? "#8a8f98",
}));

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
  // Shares (and the stacked bar) reconcile against the reported Total Generation
  // when present — it equals the fuel-breakdown sum while FUEL_KEY is complete;
  // if a bucket is ever missing the bar simply won't fill 100%, which is honest.
  const denom = y.totalGen && y.totalGen > 0 ? y.totalGen : sum;
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
                width: `${(s.twh / denom) * 100}%`,
                backgroundColor: s.color,
              }}
              title={`${bg ? s.bg : s.en}: ${fmt(s.twh)} TWh (${Math.round((s.twh / denom) * 100)}%)`}
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
                {Math.round((s.twh / denom) * 100)}%
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
