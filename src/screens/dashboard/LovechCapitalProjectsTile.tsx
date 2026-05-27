// Per-settlement breakdown of Ловеч's annual капиталова програма.
//
// Lovech (LOV18) is an oblast capital with 35 settlements (city +
// 34 villages). Source is a 77-page scanned PDF on lovech.bg; the
// capital section sits on pages 36-42. OCR via Gemini Vision can
// mis-pick a multi-year amount column, so the tile uses the council's
// authoritative `publishedRecap` for the headline rather than the
// (potentially inflated) itemised sum.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { HardHat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useLovechCapitalProgram } from "@/data/budget/useBudget";

const LVH_CAPITAL_YEARS = [2025] as const;
const LVH_CAPITAL_LATEST_YEAR = LVH_CAPITAL_YEARS[0];
const LVH_OBSHTINA = "LOV18";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

export const LovechCapitalProjectsTile: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const enabled = obshtinaCode === LVH_OBSHTINA;
  const [year, setYear] = useState<number>(LVH_CAPITAL_LATEST_YEAR);
  const { data, isLoading } = useLovechCapitalProgram(
    enabled ? year : undefined,
  );

  if (!enabled || isLoading || !data) return null;

  // Prefer the authoritative publishedRecap as headline; fall back
  // to itemised sum only if no recap is available.
  const totalEur =
    data.publishedRecap?.amountEur ?? data.recapitulation.total.amountEur;
  const topProjects = [...data.projects]
    .sort((a, b) => b.total.amountEur - a.total.amountEur)
    .slice(0, 5);
  const topSettlements = data.bySettlement.slice(0, 8);
  const maxSettlementEur = topSettlements[0]?.total.amountEur ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <HardHat className="h-4 w-4" />
          {t("lovech_capital_tile_title")}
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="ml-auto text-xs font-normal bg-transparent border rounded px-1.5 py-0.5 tabular-nums cursor-pointer hover:bg-muted/40"
            aria-label={t("sofia_capital_year_picker_label")}
          >
            {LVH_CAPITAL_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
                {lang === "bg" ? " г." : ""}
              </option>
            ))}
          </select>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("lovech_capital_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("lovech_capital_project_count", { count: data.projects.length })}
          </span>
        </div>

        {topSettlements.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("lovech_capital_by_settlement")}
            </div>
            <div className="space-y-1">
              {topSettlements.map((s) => {
                const widthPct =
                  maxSettlementEur > 0
                    ? (100 * s.total.amountEur) / maxSettlementEur
                    : 0;
                return (
                  <div
                    key={s.name}
                    className="rounded px-2 py-1 text-xs hover:bg-muted/40"
                  >
                    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3">
                      <span className="font-medium">{s.name}</span>
                      <span className="tabular-nums font-medium shrink-0">
                        {compactEur(s.total.amountEur)}
                      </span>
                      <span className="tabular-nums text-muted-foreground w-16 text-right shrink-0">
                        {t("lovech_capital_project_count_compact", {
                          count: s.projectCount,
                        })}
                      </span>
                    </div>
                    <div
                      className="h-0.5 mt-1 rounded-full bg-amber-300/70"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {topProjects.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("lovech_capital_top_projects")}
            </div>
            <div className="space-y-1">
              {topProjects.map((p) => (
                <div
                  key={p.id}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-3 rounded px-2 py-1 text-xs hover:bg-muted/40"
                >
                  <span className="line-clamp-2">{p.name}</span>
                  <span className="tabular-nums font-medium shrink-0">
                    {compactEur(p.total.amountEur)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          {t("lovech_capital_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
