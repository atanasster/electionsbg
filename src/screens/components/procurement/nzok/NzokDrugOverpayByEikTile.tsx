// "Лекарства над медианата" — one hospital's drug packs where it paid ABOVE the
// national year-median unit price, on its own /company/:eik page. The per-entity
// companion to the health pack's "Same medicine, different hospitals" tile: there
// the leaderboard is national, here it is this one facility's own rows. Each row
// links out to the molecule (/molecule/:inn) and the pack page, where the
// month-by-month trend shows whether the gap is persistent.
//
// Fed by useNzokDrugOverpayByEik; renders nothing unless this EIK matched a
// facility with above-median rows. A price gap is a SIGNPOST, not an irregularity
// — volume, delivery period and contract terms all legitimately move a unit price.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Pill } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { useNzokDrugOverpayByEik } from "@/data/budget/useBudget";
import { moleculeHref, packHref } from "./drugLinks";

export const NzokDrugOverpayByEikTile: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const { data } = useNzokDrugOverpayByEik(eik);
  if (!data || !data.rows?.length) return null;

  const rows = data.rows.slice(0, 12);
  const totalOverpay = data.rows.reduce((s, r) => s + r.overpayEur, 0);
  const innCount = new Set(data.rows.map((r) => r.inn)).size;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Pill className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          {bg ? "Лекарства над медианата" : "Medicines priced above median"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums">
            +{formatEurCompact(totalOverpay, L)}
          </span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? `над медианната цена за ${data.rows.length} опаковки на ${innCount} молекули`
              : `above the median price across ${data.rows.length} packs of ${innCount} molecules`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-2 text-left font-normal">
                  {bg ? "Лекарство" : "Medicine"}
                </th>
                <th className="py-1.5 pr-2 text-right font-normal">
                  {bg ? "Цена/ед." : "Unit"}
                </th>
                <th className="py-1.5 pr-2 text-right font-normal">
                  {bg ? "Медиана" : "Median"}
                </th>
                <th className="py-1.5 text-right font-normal">
                  {bg ? "Разлика" : "Gap"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r, i) => (
                <tr
                  key={`${r.nationalNo}|${r.nzokCode}|${i}`}
                  className="hover:bg-muted/40"
                >
                  <td className="py-1.5 pr-2">
                    <Link
                      to={packHref(r.inn, r.nationalNo, r.nzokCode)}
                      className="font-medium text-accent hover:underline"
                    >
                      {decodeEntities(r.tradeName) || r.nzokCode}
                    </Link>
                    <Link
                      to={moleculeHref(r.inn)}
                      className="block text-[10px] uppercase text-muted-foreground hover:underline"
                    >
                      {r.inn}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatEur(r.unitEur, L, { decimals: 2 })}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                    {formatEur(r.medianUnitEur, L, { decimals: 2 })}
                  </td>
                  <td className="py-1.5 text-right tabular-nums font-medium">
                    {r.ratio.toFixed(1)}×
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      +{formatEurCompact(r.overpayEur, L)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Единичната цена, платена от тази болница, спрямо медианата за същата опаковка (Национален №) за всички болници през последната пълна година. Отворете опаковка, за да видите движението по месеци — устойчивото, а не еднократното отклонение е защитимият сигнал. Ценовата разлика НЕ е нередност — може да отразява обем, срок на доставка или условия по договора. Източник: НЗОК „Справка 5“ (Наредба 10/2009)."
            : "The unit price this hospital paid versus the median for the same pack (Национален №) across all hospitals in the latest full year. Open a pack for its month-by-month trend — persistent, not one-off, dispersion is the defensible signal. A price gap is NOT an irregularity — it can reflect volume, delivery period or contract terms. Source: НЗОК “Справка 5” (Наредба 10/2009)."}
        </p>
      </CardContent>
    </Card>
  );
};
