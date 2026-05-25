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
  const { t } = useTranslation();
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
          {t("personnel_ministry_title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("personnel_ministry_subtitle", {
            headcount:
              latest.totalHeadcount.executed?.toLocaleString("en-US") ?? "—",
            year: latest.fiscalYear,
          })}
          {latest.avgAnnualCostPerFte && (
            <span>
              {" · "}
              {t("personnel_ministry_avg_label")}{" "}
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
                  <th className="py-1 pr-3">{t("personnel_table_year")}</th>
                  <th className="py-1 pr-3 text-right">
                    {t("personnel_table_plan")}
                  </th>
                  <th className="py-1 pr-3 text-right">
                    {t("personnel_table_amended")}
                  </th>
                  <th className="py-1 pr-3 text-right">
                    {t("personnel_table_actual")}
                  </th>
                  <th className="py-1 pr-3 text-right">
                    {t("personnel_table_personnel")}
                  </th>
                  <th className="py-1 pr-3 text-right">
                    {t("personnel_table_avg_per_year")}
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

        {/* Per-programme breakdown for the latest year.
            Layout strategy: Закон/Уточнен (planning history) are auxiliary
            context — they're hidden on narrow viewports (≤lg breakpoint)
            and revealed on wider screens. Mobile sees the four essentials:
            code, name, executed headcount, executed personnel, avg/yr. */}
        <div className="mb-2 text-sm font-medium">
          {t("personnel_table_by_programme", { year: latest.fiscalYear })}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th rowSpan={2} className="py-1 pr-3 align-bottom">
                  {t("personnel_table_code")}
                </th>
                <th rowSpan={2} className="py-1 pr-3 align-bottom">
                  {t("personnel_table_programme")}
                </th>
                <th
                  colSpan={3}
                  className="py-1 pr-3 text-right border-b hidden lg:table-cell"
                >
                  {t("personnel_table_headcount_group")}
                </th>
                <th
                  rowSpan={2}
                  className="py-1 pr-3 text-right align-bottom lg:hidden"
                >
                  {t("personnel_table_filled")}
                </th>
                <th
                  colSpan={3}
                  className="py-1 pr-3 text-right border-b hidden lg:table-cell"
                >
                  {t("personnel_table_personnel_group")}
                </th>
                <th
                  rowSpan={2}
                  className="py-1 pr-3 text-right align-bottom lg:hidden"
                >
                  {t("personnel_table_personnel")}
                </th>
                <th rowSpan={2} className="py-1 pr-3 text-right align-bottom">
                  {t("personnel_table_avg_per_year")}
                </th>
              </tr>
              <tr className="border-b text-left text-muted-foreground text-xs hidden lg:table-row">
                <th className="py-1 pr-3 text-right font-normal">
                  {t("personnel_table_plan")}
                </th>
                <th className="py-1 pr-3 text-right font-normal">
                  {t("personnel_table_amended_short")}
                </th>
                <th className="py-1 pr-3 text-right font-medium">
                  {t("personnel_table_actual")}
                </th>
                <th className="py-1 pr-3 text-right font-normal">
                  {t("personnel_table_plan")}
                </th>
                <th className="py-1 pr-3 text-right font-normal">
                  {t("personnel_table_amended_short")}
                </th>
                <th className="py-1 pr-3 text-right font-medium">
                  {t("personnel_table_actual")}
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
                    <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground hidden lg:table-cell">
                      {fmtN(p.headcount.law)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground hidden lg:table-cell">
                      {fmtN(p.headcount.amended)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums font-medium">
                      {fmtN(p.headcount.executed)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground hidden lg:table-cell">
                      {compactEur(p.personnel.law?.amountEur ?? null)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums text-muted-foreground hidden lg:table-cell">
                      {compactEur(p.personnel.amended?.amountEur ?? null)}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums font-medium">
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
          {t("personnel_ministry_source_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
