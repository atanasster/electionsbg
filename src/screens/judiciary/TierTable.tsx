// Per-tier league table for the selected year: how much each court tier takes
// in, how much it finishes, how fast, and what it leaves behind. Clearance and
// the within-3-months share are the two columns a reader actually feels.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Table2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatInt, formatPct } from "@/lib/currency";
import {
  clearanceRate,
  type JudiciaryTier,
} from "@/data/judiciary/useCaseload";

export const TierTable: FC<{
  tiers: JudiciaryTier[];
  total: JudiciaryTier;
  year: number;
}> = ({ tiers, total, year }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const int = (v: number) => formatInt(v, lang);
  const pct = (v: number) => formatPct(v, lang);

  const row = (t: JudiciaryTier, isTotal = false) => {
    const clr = clearanceRate(t);
    return (
      <tr
        key={t.id}
        className={
          isTotal
            ? "border-t-2 border-border font-semibold"
            : "border-t border-border/60"
        }
      >
        <td className="py-1.5 pr-3">{bg ? t.bg : t.en}</td>
        <td className="py-1.5 pr-3 text-right tabular-nums">{int(t.filed)}</td>
        <td className="py-1.5 pr-3 text-right tabular-nums">
          {int(t.resolved)}
        </td>
        <td
          className={`py-1.5 pr-3 text-right tabular-nums ${
            clr < 1 ? "text-amber-600 dark:text-amber-400" : ""
          }`}
        >
          {pct(clr)}
        </td>
        <td className="py-1.5 pr-3 text-right tabular-nums">
          {t.withinDeadlinePct}%
        </td>
        <td className="py-1.5 pr-3 text-right tabular-nums">
          {int(t.pendingEnd)}
        </td>
        <td className="py-1.5 text-right tabular-nums">{int(t.judges)}</td>
      </tr>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Table2 className="h-4 w-4" />
          {bg
            ? `Съдилищата по съдебен ред (${year})`
            : `The courts by tier (${year})`}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="pb-1.5 pr-3 text-left font-medium">
                  {bg ? "Съдилища" : "Courts"}
                </th>
                <th scope="col" className="pb-1.5 pr-3 text-right font-medium">
                  {bg ? "Постъпили" : "Filed"}
                </th>
                <th scope="col" className="pb-1.5 pr-3 text-right font-medium">
                  {bg ? "Свършени" : "Resolved"}
                </th>
                <th scope="col" className="pb-1.5 pr-3 text-right font-medium">
                  {bg ? "Приключваемост" : "Clearance"}
                </th>
                <th scope="col" className="pb-1.5 pr-3 text-right font-medium">
                  {bg ? "В срок до 3 м." : "Within 3 mo."}
                </th>
                <th scope="col" className="pb-1.5 pr-3 text-right font-medium">
                  {bg ? "Висящи" : "Pending"}
                </th>
                <th scope="col" className="pb-1.5 text-right font-medium">
                  {bg ? "Съдии" : "Judges"}
                </th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t) => row(t))}
              {row(total, true)}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {bg
            ? "Приключваемост = свършени ÷ постъпили дела. Под 100% означава, че висящите дела растат. „В срок до 3 месеца“ е делът от свършените дела, приключени в законовия срок."
            : "Clearance = resolved ÷ filed. Below 100% the backlog grows. “Within 3 months” is the share of resolved cases closed inside the statutory deadline."}
        </p>
      </CardContent>
    </Card>
  );
};
