// "Риск по лекарства" — the by-molecule companion to the per-hospital drug tile,
// on the НЗОК health pack (/awarder/121858220, migration 054). It ranks molecules
// (INN) by the total euros hospitals paid ABOVE the peer median for identical
// packs in the latest full year — the readable "which drug leaks the most money"
// view. Each INN expands to its packs so the comparison never silently drifts from
// pack identity (Национален №) to molecule level, which the drug tile forbids: the
// same molecule ships in packs whose unit prices are not comparable.
//
// As everywhere in this pack: a price gap is a SIGNPOST, not an irregularity. It
// can reflect volume, delivery period or contract terms.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Pill } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { useNzokDrugRisk } from "@/data/budget/useBudget";

export const NzokDrugRiskTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useNzokDrugRisk();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!data || !data.drugs?.length) return null;

  const rows = data.drugs.slice(0, 15);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Pill className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          {bg ? "Риск по лекарства" : "Drugs by risk"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4">
        <p className="text-xs text-muted-foreground">
          {bg
            ? `Молекули (INN), подредени по общата сума, платена над медианната цена за същата опаковка от всички болници за ${data.year} г. Разгънете реда, за да видите отделните опаковки — сравнението е по опаковка, не по молекула.`
            : `Molecules (INN) ranked by the total paid above the pack median across all hospitals in ${data.year}. Expand a row for the individual packs — the comparison is per pack, not per molecule.`}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-2 text-left font-normal">
                  {bg ? "Лекарство (INN)" : "Medicine (INN)"}
                </th>
                <th className="py-1.5 pr-2 text-right font-normal">
                  {bg ? "Болници" : "Hospitals"}
                </th>
                <th className="py-1.5 pr-2 text-right font-normal">
                  {bg ? "Над медианата" : "Above median"}
                </th>
                <th className="py-1.5 text-right font-normal">
                  {bg ? "Макс." : "Max"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((d) => {
                const isOpen = open[d.inn];
                return [
                  <tr
                    key={d.inn}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() =>
                      setOpen((o) => ({ ...o, [d.inn]: !o[d.inn] }))
                    }
                  >
                    <td className="py-1.5 pr-2">
                      <span className="flex items-center gap-1 font-medium uppercase">
                        <ChevronRight
                          className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                            isOpen ? "rotate-90" : ""
                          }`}
                        />
                        {d.inn}
                      </span>
                      <span className="ml-4 block text-[10px] text-muted-foreground">
                        {bg
                          ? `${d.packCount} ${d.packCount === 1 ? "опаковка" : "опаковки"}`
                          : `${d.packCount} pack${d.packCount === 1 ? "" : "s"}`}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                      {d.facilityCount}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums font-medium">
                      +{formatEurCompact(d.overpayEur, i18n.language)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {d.maxRatio != null ? `${d.maxRatio.toFixed(1)}×` : "—"}
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={`${d.inn}-packs`} className="bg-muted/20">
                      <td colSpan={4} className="px-2 py-1.5">
                        <table className="w-full text-[11px]">
                          <thead className="text-muted-foreground">
                            <tr>
                              <th className="py-0.5 pr-2 text-left font-normal">
                                {bg ? "Опаковка" : "Pack"}
                              </th>
                              <th className="py-0.5 pr-2 text-right font-normal">
                                {bg ? "Медиана/ед." : "Median/unit"}
                              </th>
                              <th className="py-0.5 pr-2 text-right font-normal">
                                {bg ? "Болници" : "Hospitals"}
                              </th>
                              <th className="py-0.5 pr-2 text-right font-normal">
                                {bg ? "Над мед." : "Above"}
                              </th>
                              <th className="py-0.5 text-right font-normal">
                                {bg ? "Макс." : "Max"}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.packs.map((p) => (
                              <tr key={`${p.nzokCode}|${p.nationalNo}`}>
                                <td className="py-0.5 pr-2">
                                  <span className="font-medium">
                                    {decodeEntities(p.tradeName) || p.nzokCode}
                                  </span>
                                  <span className="ml-1 text-muted-foreground">
                                    {p.nationalNo || p.nzokCode}
                                  </span>
                                </td>
                                <td className="py-0.5 pr-2 text-right tabular-nums text-muted-foreground">
                                  {formatEur(p.medianUnitEur, i18n.language, {
                                    decimals: 2,
                                  })}
                                </td>
                                <td className="py-0.5 pr-2 text-right tabular-nums text-muted-foreground">
                                  {p.facilityCount}
                                </td>
                                <td className="py-0.5 pr-2 text-right tabular-nums">
                                  +
                                  {formatEurCompact(
                                    p.overpayEur,
                                    i18n.language,
                                  )}
                                </td>
                                <td className="py-0.5 text-right tabular-nums text-muted-foreground">
                                  {p.maxRatio != null
                                    ? `${p.maxRatio.toFixed(1)}×`
                                    : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Сравнението е по конкретна опаковка (Национален №), не по молекула. Ценовата разлика НЕ е нередност — може да отразява обем, срок на доставка или условия по договора. Източник: НЗОК „Справка 5" (Наредба 10/2009), ${data.year} г.`
            : `Compared at pack identity (Национален №), not molecule. A price gap is NOT an irregularity — it can reflect volume, delivery period or contract terms. Source: НЗОК "Справка 5" (Наредба 10/2009), ${data.year}.`}
        </p>
      </CardContent>
    </Card>
  );
};
