// Per-settlement breakdown of Велико Търново's annual investment programme.
//
// V. Tarnovo (VTR04) is a Tier-2 oblast capital with 89 settlements:
// the city + town Дебелец + town Килифарево + 86 villages. Source is
// the council's "Приложения 1-22" XLSX (sheet "Pril15" — Инвестиционна
// програма), parsed directly via veliko_tarnovo.ts (no OCR — clean
// XLSX). 2025 plan totals ~€47.1M across 382 projects, ~70% tagged.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { HardHat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { NativeSelect } from "@/components/ui/native-select";
import { useVelikoTarnovoCapitalProgram } from "@/data/budget/useBudget";

// 2024 and 2025 are on disk; 2023 and earlier are not on the rebuilt
// veliko-tarnovo.bg CMS (all 404). See parser header for details.
const VT_CAPITAL_YEARS = [2025, 2024] as const;
const VT_CAPITAL_LATEST_YEAR = VT_CAPITAL_YEARS[0];
const VT_OBSHTINA = "VTR04";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

export const VelikoTarnovoCapitalProjectsTile: FC<{
  obshtinaCode: string;
}> = ({ obshtinaCode }) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const enabled = obshtinaCode === VT_OBSHTINA;
  const [year, setYear] = useState<number>(VT_CAPITAL_LATEST_YEAR);
  const { data, isLoading } = useVelikoTarnovoCapitalProgram(
    enabled ? year : undefined,
  );

  if (!enabled || isLoading || !data) return null;

  const totalEur = data.recapitulation.total.amountEur;
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
          {t("veliko_tarnovo_capital_tile_title")}
          <NativeSelect
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            wrapperClassName="ml-auto"
            className="text-xs font-normal bg-transparent border rounded px-1.5 py-0.5 tabular-nums cursor-pointer hover:bg-muted/40"
            aria-label={t("sofia_capital_year_picker_label")}
          >
            {VT_CAPITAL_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
                {lang === "bg" ? " г." : ""}
              </option>
            ))}
          </NativeSelect>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("veliko_tarnovo_capital_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("veliko_tarnovo_capital_project_count", {
              count: data.projectCount ?? data.projects.length,
            })}
          </span>
        </div>

        {topSettlements.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("veliko_tarnovo_capital_by_settlement")}
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
                        {t("veliko_tarnovo_capital_project_count_compact", {
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
              {t("veliko_tarnovo_capital_top_projects")}
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
          {t("veliko_tarnovo_capital_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
