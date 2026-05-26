// All-райони breakdown tile for Plovdiv's annual Капиталова програма.
//
// Plovdiv has a single settlement record (EKATTE 56784, obshtina PDV22) for
// the whole city, so we can't filter to "your район" the way SofiaCapital-
// ProjectsTile does. Instead this tile shows ALL 6 райони stacked, with
// total + project count + a horizontal bar per район, plus the city's
// 2-3 largest projects as an "above all райони" highlight strip.
//
// Mounted on the Plovdiv settlement page (and the município page) inside
// the existing "финанси" section. Returns null silently when the parent
// obshtina isn't PDV22 — covers the case where this component is imported
// somewhere it shouldn't render.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { HardHat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { usePlovdivCapitalProgram } from "@/data/budget/useBudget";

const PLOVDIV_CAPITAL_LATEST_YEAR = 2025;
const PLOVDIV_OBSHTINA = "PDV22";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

const cleanName = (raw: string): string =>
  raw
    .replace(/,?\s*-?\s*Район\s+[А-ЯЁа-яё]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const PlovdivCapitalProjectsTile: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const enabled = obshtinaCode === PLOVDIV_OBSHTINA;
  const { data, isLoading } = usePlovdivCapitalProgram(
    enabled ? PLOVDIV_CAPITAL_LATEST_YEAR : undefined,
  );

  if (!enabled || isLoading || !data) return null;

  const totalEur = data.recapitulation.total.amountEur;
  // Count distinct projects with at least one район tag (NOT byRayon
  // projectCount sum — that double-counts the rare multi-район project).
  const taggedCount = data.projects.filter((p) => p.rayons.length > 0).length;
  const maxRayonEur = Math.max(
    ...data.byRayon.map((r) => r.total.amountEur),
    1,
  );

  // City-wide top projects — the 3 largest. These are the headline items
  // the Plovdiv page reader is most likely to recognise.
  const topCityProjects = [...data.projects]
    .sort((a, b) => b.total.amountEur - a.total.amountEur)
    .slice(0, 3);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <HardHat className="h-4 w-4" />
          {t("plovdiv_capital_tile_title")}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {data.fiscalYear}
            {lang === "bg" ? " г." : ""}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("plovdiv_capital_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("plovdiv_capital_project_count", {
              count: data.projects.length,
            })}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            ·{" "}
            {t("plovdiv_capital_tagged_share", {
              pct:
                data.projects.length > 0
                  ? ((100 * taggedCount) / data.projects.length).toFixed(0)
                  : "0",
            })}
          </span>
        </div>

        <div>
          <div className="text-xs font-medium mb-1">
            {t("plovdiv_capital_by_rayon")}
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
                      {t("plovdiv_capital_project_count_compact", {
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
              {t("plovdiv_capital_top_city_projects")}
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
          {t("plovdiv_capital_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
