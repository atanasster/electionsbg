// "Спестяване от изравняване към медианата" — the recoverable-euros reading of the
// drug-price corpus on the НЗОК health pack (/awarder/121858220, migration 055).
// It answers a single civic question: if every hospital had paid the peer-median
// unit price for the SAME pack, how much would НЗОК have kept? The national
// headline is Σ of every hospital's above-median euros in the latest full year;
// the table ranks hospitals by that recoverable amount.
//
// This is the OpenPrescribing "ghost branded generics" framing — a concrete,
// actionable € rather than a percentile. As everywhere in this pack, a price gap
// is a SIGNPOST, not an irregularity: it can reflect volume, delivery period or
// contract terms, and the comparison holds only at pack identity (Национален №).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PiggyBank } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { civicEquivalents } from "@/lib/nzokBenchmarks";
import { useNzokDrugSavings } from "@/data/budget/useBudget";
import { FacilityLink } from "./FacilityLink";

export const NzokSavingsLeaderboardTile: FC<{ hideTitle?: boolean }> = ({
  hideTitle,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useNzokDrugSavings();
  if (!data || !data.hospitals?.length) return null;

  const rows = data.hospitals.slice(0, 20);

  return (
    <Card>
      {!hideTitle && (
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <PiggyBank className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            {bg
              ? "Спестяване към медианната цена"
              : "Savings vs the median price"}
          </CardTitle>
        </CardHeader>
      )}
      <CardContent className="space-y-3 p-3 md:p-4">
        {/* National headline — the recoverable-euros number. */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-2xl font-semibold tabular-nums text-teal-700 dark:text-teal-300">
            {formatEur(data.totalOverpayEur, i18n.language, { decimals: 0 })}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {bg
              ? `потенциално спестяване за ${data.year} г., ако всяка болница беше платила медианната цена на съответната опаковка. Разпределено сред ${data.hospitalCount} болници и ${data.innCount} молекули.`
              : `potential ${data.year} saving had every hospital paid the pack's median unit price. Across ${data.hospitalCount} hospitals and ${data.innCount} molecules.`}
          </p>
          {/* Civic translation — the sum as recognisable public-health units. */}
          {(() => {
            const c = civicEquivalents(data.totalOverpayEur);
            if (c.nurseSalaries < 1 && c.ambulances < 1) return null;
            return (
              <p className="mt-1.5 text-[11px] text-muted-foreground/90">
                {bg ? "≈ колкото " : "≈ about "}
                <span className="font-medium text-foreground">
                  {c.nurseSalaries.toLocaleString(i18n.language)}
                </span>{" "}
                {bg
                  ? "годишни заплати на медицинска сестра"
                  : "annual nurse salaries"}
                {c.ambulances >= 1 && (
                  <>
                    {bg ? " или " : " or "}
                    <span className="font-medium text-foreground">
                      {c.ambulances.toLocaleString(i18n.language)}
                    </span>{" "}
                    {bg ? "линейки" : "ambulances"}
                  </>
                )}
              </p>
            );
          })()}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-2 text-left font-normal">
                  {bg ? "Болница" : "Hospital"}
                </th>
                <th className="py-1.5 pr-2 text-right font-normal">
                  {bg ? "Молекули" : "Molecules"}
                </th>
                <th className="py-1.5 pr-2 text-right font-normal">
                  {bg ? "Опаковки" : "Packs"}
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
              {rows.map((h) => (
                <tr key={h.eik ?? h.facility} className="hover:bg-muted/40">
                  <td className="py-1.5 pr-2">
                    <FacilityLink eik={h.eik} name={h.facility} />
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                    {h.innCount}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                    {h.packCount}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-medium">
                    +{formatEurCompact(h.overpayEur, i18n.language)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {h.maxRatio != null ? `${h.maxRatio.toFixed(1)}×` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Сравнението е по конкретна опаковка (Национален №), не по молекула, само за болници над прага от 5 опаковки. „Над медианата" НЕ е нередност — може да отразява обем, срок на доставка или условия по договора; това е указание накъде да се гледа, не присъда. Източник: НЗОК „Справка 5" (Наредба 10/2009), ${data.year} г.`
            : `Compared at pack identity (Национален №), not molecule, and only for hospitals past the 5-pack floor. "Above median" is NOT an irregularity — it can reflect volume, delivery period or contract terms; it is a pointer, not a verdict. Source: НЗОК "Справка 5" (Наредба 10/2009), ${data.year}.`}
        </p>
      </CardContent>
    </Card>
  );
};
