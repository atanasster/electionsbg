// Ministry detail screen — Personnel section.
//
// Shows the staffing breakdown for one spending unit across every year for
// which the program-budget execution report carries a "Численост на щатния
// персонал" row. Per programme: headcount triple (Закон → Уточнен план →
// Отчет), Персонал spending, and the derived average annual cost per FTE.
//
// Renders nothing for ministries that don't publish headcount data
// (e.g. МО — classified).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { usePersonnel } from "@/data/budget/useBudget";
import type { MinistryHeadcountSummary } from "@/data/budget/types";

const compactEur = (v: number | null): string => {
  if (v == null) return "—";
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(1)}k`;
  return formatEur(v);
};

const fmtN = (v: number | null): string =>
  v == null ? "—" : v.toLocaleString("en-US");

interface Props {
  adminId: string;
}

export const MinistryPersonnelBlock: FC<Props> = ({ adminId }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const { data } = usePersonnel();

  // All summary entries for this ministry, newest year first.
  const summaries = useMemo<MinistryHeadcountSummary[]>(() => {
    if (!data) return [];
    const out: MinistryHeadcountSummary[] = [];
    for (const yearKey of Object.keys(data.byMinistry).sort(
      (a, b) => Number(b) - Number(a),
    )) {
      const arr = data.byMinistry[yearKey] ?? [];
      const match = arr.find((s) => s.adminId === adminId);
      if (match) out.push(match);
    }
    return out;
  }, [data, adminId]);

  if (summaries.length === 0) return null;

  const latest = summaries[0];

  return (
    <Card className="my-4" data-og="ministry-personnel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5" />
          {t("budget_ministry_personnel_title") ||
            (lang === "bg" ? "Численост на персонала" : "Personnel")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {lang === "bg"
            ? `${latest.totalHeadcount.executed?.toLocaleString("en-US") ?? "—"} щатни бройки заети към 31.12.${latest.fiscalYear} г.`
            : `${latest.totalHeadcount.executed?.toLocaleString("en-US") ?? "—"} positions filled as of 31.12.${latest.fiscalYear}`}
          {latest.avgAnnualCostPerFte && (
            <span>
              {" · "}
              {lang === "bg"
                ? "Средно възнаграждение"
                : "Average annual cost"}{" "}
              {compactEur(latest.avgAnnualCostPerFte.amountEur)}/yr
            </span>
          )}
        </p>
      </CardHeader>
      <CardContent>
        {/* Year-over-year totals */}
        {summaries.length > 1 && (
          <div className="mb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-1 pr-3">
                    {lang === "bg" ? "Година" : "Year"}
                  </th>
                  <th className="py-1 pr-3 text-right">
                    {lang === "bg" ? "Закон" : "Plan"}
                  </th>
                  <th className="py-1 pr-3 text-right">
                    {lang === "bg" ? "Уточнен" : "Amended"}
                  </th>
                  <th className="py-1 pr-3 text-right">
                    {lang === "bg" ? "Отчет" : "Actual"}
                  </th>
                  <th className="py-1 pr-3 text-right">
                    {lang === "bg" ? "Персонал" : "Personnel"}
                  </th>
                  <th className="py-1 pr-3 text-right">
                    {lang === "bg" ? "Ср. / год." : "Avg / yr"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.fiscalYear} className="border-b last:border-0">
                    <td className="py-1 pr-3">{s.fiscalYear}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {fmtN(s.totalHeadcount.law)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {fmtN(s.totalHeadcount.amended)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums font-medium">
                      {fmtN(s.totalHeadcount.executed)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {compactEur(s.totalPersonnel.executed?.amountEur ?? null)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">
                      {compactEur(s.avgAnnualCostPerFte?.amountEur ?? null)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Per-programme breakdown for the latest year */}
        <div className="mb-2 text-sm font-medium">
          {lang === "bg"
            ? `По програми — ${latest.fiscalYear} г.`
            : `By programme — ${latest.fiscalYear}`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1 pr-3">{lang === "bg" ? "Код" : "Code"}</th>
                <th className="py-1 pr-3">
                  {lang === "bg" ? "Програма" : "Programme"}
                </th>
                <th className="py-1 pr-3 text-right">
                  {lang === "bg" ? "Заети" : "Filled"}
                </th>
                <th className="py-1 pr-3 text-right">
                  {lang === "bg" ? "Персонал" : "Personnel"}
                </th>
                <th className="py-1 pr-3 text-right">
                  {lang === "bg" ? "Ср. / год." : "Avg / yr"}
                </th>
              </tr>
            </thead>
            <tbody>
              {latest.programmes
                .slice()
                .sort(
                  (a, b) =>
                    (b.personnel.executed?.amountEur ?? 0) -
                    (a.personnel.executed?.amountEur ?? 0),
                )
                .map((p) => (
                  <tr key={p.code} className="border-b last:border-0">
                    <td className="py-1 pr-3 tabular-nums text-xs text-muted-foreground">
                      {p.code}
                    </td>
                    <td className="py-1 pr-3">{p.nameBg}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {fmtN(p.headcount.executed)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {compactEur(p.personnel.executed?.amountEur ?? null)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground">
                      {compactEur(p.avgAnnualCostPerFte?.amountEur ?? null)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {lang === "bg"
            ? "Източник: Отчет за изпълнението на програмния бюджет — секция „Персонал“ и ред „Численост на щатния персонал“. Средното възнаграждение включва осигуровки за сметка на работодателя."
            : "Source: Program Budget Execution Report — Personnel line and Staffing row. Average cost includes employer social-security contributions."}
        </p>
      </CardContent>
    </Card>
  );
};
