// Per-settlement breakdown of Русе's annual капиталова програма.
//
// Русе isn't районирана but has 12 villages + 1 town with their own
// kmetstvo administration. The source XLSX has a dedicated SHEET per
// kmetstvo, so per-settlement attribution is via workbook structure
// (100% accurate for the 13 sub-settlements) — unlike Burgas / Stara
// Zagora where village localisation goes through free-text regex.
//
// UX mirrors Stara Zagora: total + per-village strip + top projects.
//
// Mounted on Русе settlement (EKATTE 63427, obshtina RSE27) and the
// município page. Returns null silently for any other muni.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { HardHat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useRuseCapitalProgram } from "@/data/budget/useBudget";

// 2022's source is an "Капиталов отчет" (executed-only), so its
// headline is the actual spent figure rather than a refined plan —
// noted in the tile via a year-specific caveat.
const RUSE_CAPITAL_YEARS = [2025, 2024, 2023, 2022] as const;
const RUSE_CAPITAL_LATEST_YEAR = RUSE_CAPITAL_YEARS[0];
const RUSE_OBSHTINA = "RSE27";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

export const RuseCapitalProjectsTile: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const enabled = obshtinaCode === RUSE_OBSHTINA;
  const [year, setYear] = useState<number>(RUSE_CAPITAL_LATEST_YEAR);
  const { data, isLoading } = useRuseCapitalProgram(enabled ? year : undefined);

  if (!enabled || isLoading || !data) return null;

  const totalEur = data.recapitulation.total.amountEur;
  const topCityProjects = [...data.projects]
    .sort((a, b) => b.total.amountEur - a.total.amountEur)
    .slice(0, 5);
  const topSettlements = data.bySettlement.slice(0, 8);
  const maxSettlementEur = topSettlements[0]?.total.amountEur ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <HardHat className="h-4 w-4" />
          {t("ruse_capital_tile_title")}
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="ml-auto text-xs font-normal bg-transparent border rounded px-1.5 py-0.5 tabular-nums cursor-pointer hover:bg-muted/40"
            aria-label={t("sofia_capital_year_picker_label")}
          >
            {RUSE_CAPITAL_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
                {lang === "bg" ? " г." : ""}
              </option>
            ))}
          </select>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("ruse_capital_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("ruse_capital_project_count", {
              count: data.projectCount ?? data.projects.length,
            })}
          </span>
        </div>

        {topSettlements.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("ruse_capital_by_settlement")}
            </div>
            <div className="space-y-1">
              {topSettlements.map((s) => {
                const widthPct =
                  maxSettlementEur > 0
                    ? (100 * s.total.amountEur) / maxSettlementEur
                    : 0;
                const prefix = s.name === "Мартен" ? "гр." : "с.";
                return (
                  <div
                    key={s.name}
                    className="rounded px-2 py-1 text-xs hover:bg-muted/40"
                  >
                    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3">
                      <span className="font-medium">
                        {prefix} {s.name}
                      </span>
                      <span className="tabular-nums font-medium shrink-0">
                        {compactEur(s.total.amountEur)}
                      </span>
                      <span className="tabular-nums text-muted-foreground w-16 text-right shrink-0">
                        {t("ruse_capital_project_count_compact", {
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

        {topCityProjects.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("ruse_capital_top_projects")}
            </div>
            <div className="space-y-1">
              {topCityProjects.map((p) => (
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
          {t("ruse_capital_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
