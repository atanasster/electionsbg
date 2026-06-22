// Yambol's annual капиталова програма. Single-settlement município
// (JAM26 = just the city — no villages, same shape as Dobrich-grad)
// so the tile leads with recap + top projects, no per-village strip.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { HardHat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { NativeSelect } from "@/components/ui/native-select";
import { useYambolCapitalProgram } from "@/data/budget/useBudget";

const YAM_CAPITAL_YEARS = [2025, 2024, 2023, 2022] as const;
const YAM_CAPITAL_LATEST_YEAR = YAM_CAPITAL_YEARS[0];
const YAM_OBSHTINA = "JAM26";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

export const YambolCapitalProjectsTile: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const enabled = obshtinaCode === YAM_OBSHTINA;
  const [year, setYear] = useState<number>(YAM_CAPITAL_LATEST_YEAR);
  const { data, isLoading } = useYambolCapitalProgram(
    enabled ? year : undefined,
  );

  if (!enabled || isLoading || !data) return null;

  const totalEur = data.recapitulation.total.amountEur;
  const topProjects = [...data.projects]
    .sort((a, b) => b.total.amountEur - a.total.amountEur)
    .slice(0, 8);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <HardHat className="h-4 w-4" />
          {t("yambol_capital_tile_title")}
          <NativeSelect
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            wrapperClassName="ml-auto"
            className="text-xs font-normal bg-transparent border rounded px-1.5 py-0.5 tabular-nums cursor-pointer hover:bg-muted/40"
            aria-label={t("sofia_capital_year_picker_label")}
          >
            {YAM_CAPITAL_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
                {lang === "bg" ? " г." : ""}
              </option>
            ))}
          </NativeSelect>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("yambol_capital_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("yambol_capital_project_count", {
              count: data.projectCount ?? data.projects.length,
            })}
          </span>
        </div>

        {topProjects.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("yambol_capital_top_projects")}
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
          {t("yambol_capital_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
