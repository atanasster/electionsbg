// All-райони breakdown tile for Варна's annual Капиталова програма
// (Приложение №4). Source is a 71-page rasterized PDF that we OCR via
// Gemini Vision in a one-shot pre-step (see scripts/budget/capital_programs/
// varna_ocr.ts); this tile consumes the structured roll-up that the
// downstream parser produces.
//
// UX mirrors Plovdiv: single settlement record for the whole city, so
// we show ALL 5 райони (Одесос, Приморски, Младост, Аспарухово,
// Владислав Варненчик) stacked with totals + project counts, then a
// top-3 city-wide-projects strip.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { HardHat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useVarnaCapitalProgram } from "@/data/budget/useBudget";

const VARNA_CAPITAL_LATEST_YEAR = 2025;
const VARNA_OBSHTINA = "VAR06";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

const cleanName = (raw: string): string =>
  raw
    .replace(/,?\s*-?\s*район\s*[„"]?[А-ЯЁа-яё\s.]+["“]?/giu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const VarnaCapitalProjectsTile: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const enabled = obshtinaCode === VARNA_OBSHTINA;
  const { data, isLoading } = useVarnaCapitalProgram(
    enabled ? VARNA_CAPITAL_LATEST_YEAR : undefined,
  );

  if (!enabled || isLoading || !data) return null;

  const totalEur = data.recapitulation.total.amountEur;
  const taggedCount = data.projects.filter((p) => p.rayons.length > 0).length;
  const maxRayonEur = Math.max(
    ...data.byRayon.map((r) => r.total.amountEur),
    1,
  );
  const topCityProjects = [...data.projects]
    .sort((a, b) => b.total.amountEur - a.total.amountEur)
    .slice(0, 3);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <HardHat className="h-4 w-4" />
          {t("varna_capital_tile_title")}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {data.fiscalYear}
            {lang === "bg" ? " г." : ""}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("varna_capital_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("varna_capital_project_count", { count: data.projects.length })}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            ·{" "}
            {t("varna_capital_tagged_share", {
              pct:
                data.projects.length > 0
                  ? ((100 * taggedCount) / data.projects.length).toFixed(0)
                  : "0",
            })}
          </span>
        </div>

        <div>
          <div className="text-xs font-medium mb-1">
            {t("varna_capital_by_rayon")}
          </div>
          <div className="space-y-1">
            {data.byRayon.map((r) => {
              const eur = r.total.amountEur;
              const widthPct = maxRayonEur > 0 ? (100 * eur) / maxRayonEur : 0;
              const name = lang === "bg" ? r.labelBg : r.labelEn;
              return (
                <div
                  key={r.code}
                  className="rounded px-2 py-1 text-xs hover:bg-muted/40"
                >
                  <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3">
                    <span className="font-medium">{name}</span>
                    <span className="tabular-nums font-medium shrink-0">
                      {compactEur(eur)}
                    </span>
                    <span className="tabular-nums text-muted-foreground w-16 text-right shrink-0">
                      {t("varna_capital_project_count_compact", {
                        count: r.projectCount,
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

        {topCityProjects.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("varna_capital_top_city_projects")}
            </div>
            <div className="space-y-1">
              {topCityProjects.map((p) => (
                <div
                  key={p.id}
                  className="grid grid-cols-[1fr_auto] items-baseline gap-3 rounded px-2 py-1 text-xs hover:bg-muted/40"
                >
                  <span className="line-clamp-2">{cleanName(p.name)}</span>
                  <span className="tabular-nums font-medium shrink-0">
                    {compactEur(p.total.amountEur)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          {t("varna_capital_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
