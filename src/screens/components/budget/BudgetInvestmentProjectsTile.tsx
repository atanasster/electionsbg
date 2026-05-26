// Investment-program composition tile — surfaces the per-project capital
// allocations the Sankey "Капиталови разходи" drilldown shows, always visible
// in the Composition section.
//
// Headline: program total + project count. Below: top-5 category bars + top-5
// projects table. Falls through silently when no annex data is available for
// the selected fiscal year (mirrors BudgetPersonnelTile fall-through pattern).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HardHat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import {
  useInvestmentProgram,
  useInvestmentProgramIndex,
} from "@/data/budget/useBudget";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return formatEur(v);
};

const CATEGORY_COLOURS: Record<string, string> = {
  roads: "#f59e0b",
  water_sewage: "#0ea5e9",
  education: "#10b981",
  social: "#ef4444",
  sports: "#a855f7",
  culture: "#ec4899",
  buildings: "#84cc16",
  energy: "#facc15",
  other: "#94a3b8",
};

export const BudgetInvestmentProjectsTile: FC<{ fiscalYear: number }> = ({
  fiscalYear,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const { data: index } = useInvestmentProgramIndex();

  const dataYear = useMemo(() => {
    if (!index || index.years.length === 0) return null;
    const exact = index.years.find((y) => y.fiscalYear === fiscalYear);
    if (exact) return exact.fiscalYear;
    return [...index.years].sort((a, b) => b.fiscalYear - a.fiscalYear)[0]
      .fiscalYear;
  }, [index, fiscalYear]);

  const { data: program } = useInvestmentProgram(dataYear ?? undefined);

  if (!program || dataYear == null) return null;

  const totalEur = program.grandTotal.amountEur;
  if (totalEur === 0) return null;

  const topCategories = program.byCategory.slice(0, 6);
  const maxCatEur = topCategories[0]?.total.amountEur ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <HardHat className="h-4 w-4" />
          {t("investment_tile_title")}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {dataYear}
            {lang === "bg" ? " г." : ""}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("investment_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("investment_tile_count_caption", {
              count: program.projectCount,
            })}
          </span>
        </div>

        {/* Top categories */}
        <div className="space-y-1">
          {topCategories.map((cat) => {
            const eur = cat.total.amountEur;
            const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
            const widthPct = maxCatEur > 0 ? (eur / maxCatEur) * 100 : 0;
            return (
              <div
                key={cat.key}
                className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3"
              >
                <div className="relative h-5">
                  <div
                    className="absolute inset-y-0 left-0 rounded-sm"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: CATEGORY_COLOURS[cat.key] ?? "#94a3b8",
                      opacity: 0.45,
                    }}
                  />
                  <div className="relative px-1 text-xs truncate leading-5">
                    {lang === "bg" ? cat.labelBg : cat.labelEn}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {cat.count}
                    </span>
                  </div>
                </div>
                <span className="tabular-nums text-xs font-medium">
                  {compactEur(eur)}
                </span>
                <span className="tabular-nums text-[10px] text-muted-foreground w-10 text-right">
                  {pct >= 0.5 ? `${pct.toFixed(1)}%` : ""}
                </span>
              </div>
            );
          })}
        </div>

        {/* Top 5 projects */}
        <div className="border-t pt-2">
          <div className="text-xs font-medium mb-1">
            {t("investment_tile_top_projects")}
          </div>
          <div className="space-y-0.5">
            {program.topProjects.slice(0, 5).map((p) => (
              <div
                key={p.projectId}
                className="grid grid-cols-[auto_1fr_auto] items-baseline gap-3 text-xs px-1"
                title={p.name}
              >
                <span className="tabular-nums text-[10px] text-muted-foreground">
                  {p.projectId}
                </span>
                <span className="truncate">
                  {p.name.slice(0, 60)}
                  {p.name.length > 60 ? "…" : ""}
                  <span className="text-muted-foreground ml-2 text-[10px]">
                    {p.municipalityNameBg ?? "—"}
                  </span>
                </span>
                <span className="tabular-nums font-medium">
                  {compactEur(p.cost.amountEur)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
