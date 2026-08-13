// "What you pay" tile for /sector/energy — household electricity price, BG vs the
// EU. The citizen-facing counterpoint to the group's state spending (no € quoted
// here on purpose — see the note in EnergyThematicTiles): BG has among the LOWEST
// household electricity prices in the EU. The gap is NOT a constant and is not
// stated here — it has closed from 39% to 47% of the EU average in five
// semesters; the tile renders whatever `latestCommonPrice` returns.
// Full-history (scope-independent). Data: Eurostat nrg_pc_204 (CC — © EU).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useEnergyPrices } from "@/data/energy/useEnergyPrices";
import { latestCommonPrice } from "@/data/energy/types";

const BG_COLOR = "#c9702f";
const EU_COLOR = "#7f85a3";

/** The sentence beside the ratio, DERIVED from it. It used to read "сред
 *  най-ниските в съюза" unconditionally — true today at 47%, but a claim the
 *  tile kept making regardless of what the series said, and the gap has closed
 *  from 39% to 47% in five semesters. Deriving it means the prose can never
 *  contradict the number printed next to it. The 75% cut keeps "among the
 *  lowest" for a genuine outlier and steps down to a plain comparison before it
 *  becomes a stretch. */
const verdict = (pctOfEu: number): { bg: string; en: string } => {
  if (pctOfEu <= 75)
    return { bg: "сред най-ниските в съюза", en: "among the lowest in the union" }; // prettier-ignore
  if (pctOfEu < 100)
    return { bg: "под средното за ЕС", en: "below the EU average" };
  return { bg: "над средното за ЕС", en: "above the EU average" };
};

export const EnergyPriceTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const { data } = useEnergyPrices();
  if (!data) return null;

  // Anchor BG and EU to the latest period present in BOTH series (EU27 can lag).
  const cmp = latestCommonPrice(data);
  if (!cmp) return null;
  const max = Math.max(cmp.bg, cmp.eu) || 1;

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
            value={cmp.bg}
            color={BG_COLOR}
          />
          <Row
            label={bg ? "ЕС (средно)" : "EU average"}
            value={cmp.eu}
            color={EU_COLOR}
          />
        </div>
        <p className="pt-1 text-sm">
          {bg ? (
            <>
              България:{" "}
              <span className="font-semibold" style={{ color: BG_COLOR }}>
                {cmp.pctOfEu}%
              </span>{" "}
              от средната цена за ЕС — {verdict(cmp.pctOfEu).bg}.
            </>
          ) : (
            <>
              Bulgaria:{" "}
              <span className="font-semibold" style={{ color: BG_COLOR }}>
                {cmp.pctOfEu}%
              </span>{" "}
              of the EU average — {verdict(cmp.pctOfEu).en}.
            </>
          )}
        </p>
        <div className="text-[11px] text-muted-foreground">
          {bg
            ? "С всички данъци, band 2500-4999 kWh · "
            : "All taxes, 2500-4999 kWh band · "}
          {cmp.period} · {bg ? "Източник: Eurostat" : "Source: Eurostat"}
        </div>
      </CardContent>
    </Card>
  );
};
