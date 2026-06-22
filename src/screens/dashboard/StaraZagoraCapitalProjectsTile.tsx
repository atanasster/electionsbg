// Per-settlement breakdown of Стара Загора's annual Капиталова програма
// (Приложение №4 to the council's budget decision).
//
// Стара Загора isn't районирана, so the tile pattern mirrors Burgas
// minus the funding-source mini-grid (the source PDF has 9 funding
// sub-columns but reliable extraction would need new parser work —
// deferred to a v2). Headline shows the recap total + project count;
// then a per-settlement strip surfacing the school-renovation cluster
// in the 11 villages where the document tags по село; finally the top
// 5 city-wide projects by amount.
//
// Mounted on Стара Загора settlement (EKATTE 68850, obshtina SZR31)
// and the município page. Returns null silently for any other muni.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { HardHat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStaraZagoraCapitalProgram } from "@/data/budget/useBudget";

const SZ_CAPITAL_YEARS = [2025, 2024, 2023, 2022] as const;
const SZ_CAPITAL_LATEST_YEAR = SZ_CAPITAL_YEARS[0];
const SZ_OBSHTINA = "SZR31";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

export const StaraZagoraCapitalProjectsTile: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const enabled = obshtinaCode === SZ_OBSHTINA;
  const [year, setYear] = useState<number>(SZ_CAPITAL_LATEST_YEAR);
  const { data, isLoading } = useStaraZagoraCapitalProgram(
    enabled ? year : undefined,
  );

  if (!enabled || isLoading || !data) return null;

  const totalEur = data.recapitulation.total.amountEur;
  const topCityProjects = [...data.projects]
    .sort((a, b) => b.total.amountEur - a.total.amountEur)
    .slice(0, 5);
  const topSettlements = data.bySettlement.slice(0, 6);
  const maxSettlementEur = topSettlements[0]?.total.amountEur ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <HardHat className="h-4 w-4" />
          {t("stara_zagora_capital_tile_title")}
          <Select
            value={String(year)}
            onValueChange={(v) => setYear(Number(v))}
          >
            <SelectTrigger
              aria-label={t("sofia_capital_year_picker_label")}
              className="ml-auto h-auto w-auto cursor-pointer gap-1 border-border bg-transparent px-1.5 py-0.5 text-xs font-normal tabular-nums hover:bg-muted/40"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SZ_CAPITAL_YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                  {lang === "bg" ? " г." : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("stara_zagora_capital_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("stara_zagora_capital_recap_caveat")}
          </span>
        </div>

        {topSettlements.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("stara_zagora_capital_by_settlement")}
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
                      <span className="font-medium">с. {s.name}</span>
                      <span className="tabular-nums font-medium shrink-0">
                        {compactEur(s.total.amountEur)}
                      </span>
                      <span className="tabular-nums text-muted-foreground w-16 text-right shrink-0">
                        {t("stara_zagora_capital_project_count_compact", {
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
              {t("stara_zagora_capital_top_projects")}
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
          {t("stara_zagora_capital_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
