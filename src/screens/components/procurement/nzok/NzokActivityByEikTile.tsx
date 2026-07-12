// "Какво лекува тази болница" — one hospital's case-mix, on its own /company/:eik
// page. The companion to NzokHospitalReimbursementTile (money in) and the drug /
// financials strips: this shows the WORK behind that money — the clinical pathways
// and procedures НЗОК paid it for, in cases, and each one's share of the national
// volume. It is the case-mix DENOMINATOR that makes any per-patient figure on the
// page interpretable.
//
// Cases are volume, not value (the source carries the procedure code only, no НРД
// price). Fed by useNzokActivitiesByEik; renders nothing unless this EIK matched a
// facility in the activity crosswalk (private hospitals included, unmatched → null).

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  useNzokActivitiesByEik,
  useNzokProcedureNames,
} from "@/data/budget/useBudget";
import { resolveProcedureName, procedureHref } from "@/lib/nzokProcedures";

const nf = (n: number, lang: string) =>
  n.toLocaleString(lang === "bg" ? "bg" : "en");

export const NzokActivityByEikTile: FC<{ eik: string }> = ({ eik }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useNzokActivitiesByEik(eik);
  const { data: procNames } = useNzokProcedureNames();
  if (!data || !data.topProcedures?.length) return null;

  const rows = data.topProcedures.slice(0, 10);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-teal-600 dark:text-teal-400" />
          {bg ? "Дейности по НЗОК (случаи)" : "НЗОК clinical activity (cases)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums">
            {nf(data.totalCases, lang)}
          </span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? `случая по ${nf(data.procedureCount, lang)} процедури (${data.year})`
              : `cases across ${nf(data.procedureCount, lang)} procedures (${data.year})`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="py-1.5 pr-2 text-left font-normal">
                  {bg ? "Процедура" : "Procedure"}
                </th>
                <th className="py-1.5 pr-2 text-left font-normal">
                  {bg ? "Вид" : "Type"}
                </th>
                <th className="py-1.5 pr-2 text-right font-normal">
                  {bg ? "Случаи" : "Cases"}
                </th>
                <th className="py-1.5 text-right font-normal">
                  {bg ? "Дял нац." : "Nat. share"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => {
                const name = resolveProcedureName(procNames, p.procedure);
                return (
                  <tr key={p.procedure}>
                    <td className="py-1.5 pr-2">
                      <Link
                        to={procedureHref(p.procedure)}
                        className="text-accent hover:underline"
                      >
                        {name ? (
                          <>
                            <span
                              className="block max-w-[18rem] truncate"
                              title={name}
                            >
                              {name}
                            </span>
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {p.procedure}
                            </span>
                          </>
                        ) : (
                          <span className="font-medium tabular-nums">
                            {p.procedure}
                          </span>
                        )}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-2 text-muted-foreground">
                      {p.procType}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {nf(p.cases, lang)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                      {p.nationalSharePct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Брой отчетени случаи по клинична пътека (КП), амбулаторна (АПр) и клинична процедура (КПр); „дял нац.“ е делът на болницата от всички случаи по тази процедура в страната. Броят е обем, не стойност — източникът съдържа само кода на процедурата. Източник: НЗОК, месечни отчети за дейността."
            : "Reported cases per clinical pathway (КП), ambulatory (АПр) and clinical procedure (КПр); “nat. share” is this hospital's share of all national cases on that procedure. Cases are volume, not value — the source carries the procedure code only. Source: НЗОК monthly activity reports."}
        </p>
      </CardContent>
    </Card>
  );
};
