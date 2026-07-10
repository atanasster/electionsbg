// "Финансово състояние на болниците" — the national aggregate of the МЗ quarterly
// hospital financial indicators, on the НЗОК health pack (/awarder/121858220).
//
// The pack already answers where НЗОК's money goes. This answers what happens to
// it once it lands: whether the hospitals it pays are solvent. `Просрочени
// задължения` (overdue liabilities) is the number that matters — total debt can
// be ordinary working capital, but overdue debt is a supplier who has not been
// paid on time, and it is the leading indicator of a hospital in trouble.
//
// Source: МЗ, "Финансови показатели на лечебни заведения за болнична помощ",
// quarterly since 2019-Q2 under Наредба № 5 от 2019. Self-hides until migration
// 051 reaches the database.
//
// Nothing here is ranked per patient. See NzokFinancialHealthStrip for why.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useNzokHospitalFinancials } from "@/data/budget/useBudget";

export const NzokHospitalFinancialsTile: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const { data } = useNzokHospitalFinancials();
  if (!data?.quarter) return null;

  const result = data.totalRevenueEur - data.totalExpenseEur;
  const loss = result < 0;
  const rows = (["state", "municipal"] as const).map((k) => ({
    key: k,
    label:
      k === "state"
        ? bg
          ? "Държавни"
          : "State-owned"
        : bg
          ? "Общински"
          : "Municipal",
    o: data.byOwnership[k],
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="h-4 w-4 text-slate-600 dark:text-slate-400" />
          {bg
            ? "Финансово състояние на болниците"
            : "Hospitals' financial condition"}
          <span className="text-xs font-normal text-muted-foreground">
            {data.quarter}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums text-rose-700 dark:text-rose-400">
            {formatEurCompact(data.totalOverdueLiabilitiesEur, i18n.language)}
          </span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? `просрочени задължения на ${data.hospitalCount} болници`
              : `in overdue liabilities across ${data.hospitalCount} hospitals`}
          </span>
        </div>

        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="py-1.5 text-left font-normal">
                {bg ? "Собственост" : "Ownership"}
              </th>
              <th className="py-1.5 text-right font-normal">
                {bg ? "Болници" : "Hospitals"}
              </th>
              <th className="py-1.5 text-right font-normal">
                {bg ? "Приходи" : "Revenue"}
              </th>
              <th className="py-1.5 text-right font-normal">
                {bg ? "Задължения" : "Liabilities"}
              </th>
              <th className="py-1.5 text-right font-normal">
                {bg ? "Просрочени" : "Overdue"}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ key, label, o }) => (
              <tr key={key}>
                <td className="py-1.5">{label}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {o.hospitalCount}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatEurCompact(o.revenueEur, i18n.language)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatEurCompact(o.totalLiabilitiesEur, i18n.language)}
                </td>
                <td className="py-1.5 text-right font-medium tabular-nums">
                  {formatEurCompact(o.overdueLiabilitiesEur, i18n.language)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="text-xs text-muted-foreground">
          {bg
            ? `Общо за тримесечието: приходи ${formatEurCompact(data.totalRevenueEur, i18n.language)} срещу разходи ${formatEurCompact(data.totalExpenseEur, i18n.language)} — ${loss ? "загуба" : "печалба"} от ${formatEurCompact(Math.abs(result), i18n.language)}.`
            : `For the quarter: ${formatEurCompact(data.totalRevenueEur, i18n.language)} of revenue against ${formatEurCompact(data.totalExpenseEur, i18n.language)} of expense — a ${loss ? "loss" : "profit"} of ${formatEurCompact(Math.abs(result), i18n.language)}.`}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Източник: Министерство на здравеопазването, „Финансови показатели на лечебни заведения за болнична помощ" (Наредба № 5 от 2019 г.), тримесечно от 2019 г. Обхваща държавните и общинските болници; частните не подават тези отчети. Просрочените задължения са по-важният показател — общата задлъжнялост може да е нормален оборотен капитал.`
            : `Source: the Ministry of Health's quarterly "Financial indicators of inpatient-care providers" (Наредба № 5/2019), since 2019. Covers state- and municipally-owned hospitals; private ones do not file these returns. Overdue liabilities are the sharper indicator — total debt can be ordinary working capital.`}
        </p>
      </CardContent>
    </Card>
  );
};
