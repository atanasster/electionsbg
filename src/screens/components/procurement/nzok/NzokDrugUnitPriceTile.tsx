// "Цени на лекарства по болници" — per-hospital UNIT prices for the same pack of
// the same medicine, on the НЗОК health pack (/awarder/121858220).
//
// Why this tile exists, and what it deliberately does NOT claim.
//
// НЗОК publishes, monthly, what every hospital was reimbursed for every pack of
// every oncology / coagulopathy medicine ("Справка 5", Наредба 10/2009). Dividing
// the reimbursed sum by (packs × pack size) gives a unit price that is directly
// comparable ACROSS hospitals — but only at PACK identity. One INN spans many
// packs: PEMETREXED alone has five, whose per-unit medians run from €17 to €66.
// Comparing at INN level would measure pack size, not procurement.
//
// A price gap is not wrongdoing. Volume discounts, delivery period and contract
// terms all legitimately move a unit price, and a single-pack purchase has no
// negotiating context at all — hence the volume floor the API reports and this
// tile prints. What the corpus can defend is PERSISTENT dispersion: the same
// hospital, the same pack, above the median month after month. That is what the
// per-pack trend endpoint answers, and it is the one question a single year of
// data structurally cannot.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Pill } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { useNzokDrugUnitPrices } from "@/data/budget/useBudget";
import { decodeEntities } from "@/lib/decodeEntities";

export const NzokDrugUnitPriceTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useNzokDrugUnitPrices();
  if (!data || !data.overpay?.length) return null;

  const rows = data.overpay.slice(0, 12);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Pill className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          {bg
            ? "Цени на едно и също лекарство по болници"
            : "Same medicine, different hospitals"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4">
        <p className="text-xs text-muted-foreground">
          {bg
            ? `Сравнение на цената за единица (флакон, спринцовка, таблетка) за една и съща опаковка на едно и също лекарство. Показани са най-големите отклонения спрямо медианата за същата опаковка за ${data.latestPeriod}.`
            : `Unit price (vial, syringe, tablet) for the identical pack of the identical medicine. Largest deviations from that pack's median, ${data.latestPeriod}.`}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-2 text-left font-normal">
                  {bg ? "Лекарство" : "Medicine"}
                </th>
                <th className="py-1.5 pr-2 text-left font-normal">
                  {bg ? "Болница" : "Hospital"}
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
              {rows.map((r) => (
                <tr key={`${r.nationalNo}|${r.nzokCode}|${r.regNo}`}>
                  <td className="py-1.5 pr-2">
                    <span className="font-medium">
                      {decodeEntities(r.tradeName)}
                    </span>
                    <span className="block text-[10px] uppercase text-muted-foreground">
                      {r.inn}
                    </span>
                  </td>
                  <td className="max-w-[14rem] truncate py-1.5 pr-2 text-muted-foreground">
                    {decodeEntities(r.facility)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatEur(r.unitEur, i18n.language, { decimals: 2 })}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                    {formatEur(r.medianUnitEur, i18n.language, { decimals: 2 })}
                  </td>
                  <td className="py-1.5 text-right tabular-nums font-medium">
                    {r.ratio.toFixed(1)}×
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      +{formatEurCompact(r.overpayEur, i18n.language)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Сравнението е по конкретна опаковка (Национален №), не по молекула — една и съща молекула се предлага в опаковки с различен размер, чиито единични цени не са съпоставими. Включени са само доставки от поне ${data.volumeFloorPacks} опаковки: при единични бройки няма отстъпка за обем. Ценовата разлика НЕ е нередност — тя може да отразява обем, срок на доставка или условия по договора. Източник: НЗОК, „Справка 5" (Наредба 10/2009).`
            : `Compared at pack identity (Национален №), not at molecule level — the same molecule ships in packs whose unit prices are not comparable. Only deliveries of at least ${data.volumeFloorPacks} packs are included: single units carry no volume discount. A price gap is NOT an irregularity — it can reflect volume, delivery period or contract terms. Source: НЗОК "Справка 5" (Наредба 10/2009).`}
        </p>
      </CardContent>
    </Card>
  );
};
