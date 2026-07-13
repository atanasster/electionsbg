// "What you pay" tile for /sector/energy — household electricity price, BG vs the
// EU. The citizen-facing counterpoint to the €9.76bn of state spending: BG has
// among the LOWEST household electricity prices in the EU (~half the average).
// Full-history (scope-independent). Data: Eurostat nrg_pc_204 (CC — © EU).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useEnergyPrices } from "@/data/energy/useEnergyPrices";

const BG_COLOR = "#c9702f";
const EU_COLOR = "#7f85a3";

export const EnergyPriceTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const { data } = useEnergyPrices();
  if (!data) return null;

  const bgS = data.series.BG;
  const euS = data.series.EU27;
  if (bgS.length === 0 || euS.length === 0) return null;
  const lb = bgS[bgS.length - 1];
  const le = euS[euS.length - 1];
  const ratio = le.value > 0 ? lb.value / le.value : 0;
  const pctOfEu = Math.round(ratio * 100);
  const max = Math.max(lb.value, le.value) || 1;

  const eur = (v: number) =>
    `€${v.toLocaleString(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;

  const Row: FC<{ label: string; value: number; color: string }> = ({
    label,
    value,
    color,
  }) => (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-24 shrink-0">{label}</div>
      <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
        <div
          className="absolute inset-y-0 left-0 rounded"
          style={{ width: `${(value / max) * 100}%`, backgroundColor: color }}
        />
      </div>
      <div className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
        {eur(value)}/kWh
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {bg ? "Цена на тока за домакинствата" : "Household electricity price"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 p-3 md:p-4">
        <div className="space-y-1.5">
          <Row
            label={bg ? "България" : "Bulgaria"}
            value={lb.value}
            color={BG_COLOR}
          />
          <Row
            label={bg ? "ЕС (средно)" : "EU average"}
            value={le.value}
            color={EU_COLOR}
          />
        </div>
        <p className="pt-1 text-sm">
          {bg ? (
            <>
              България:{" "}
              <span className="font-semibold" style={{ color: BG_COLOR }}>
                {pctOfEu}%
              </span>{" "}
              от средната цена за ЕС — сред най-ниските в съюза.
            </>
          ) : (
            <>
              Bulgaria:{" "}
              <span className="font-semibold" style={{ color: BG_COLOR }}>
                {pctOfEu}%
              </span>{" "}
              of the EU average — among the lowest in the union.
            </>
          )}
        </p>
        <div className="text-[11px] text-muted-foreground">
          {bg
            ? "С всички данъци, band 2500-4999 kWh · "
            : "All taxes, 2500-4999 kWh band · "}
          {lb.period} · {bg ? "Източник: Eurostat" : "Source: Eurostat"}
        </div>
      </CardContent>
    </Card>
  );
};
