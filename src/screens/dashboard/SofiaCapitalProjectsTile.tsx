// Per-район tile showing Sofia's annual капиталова програма line items
// that touch this район. The XLSX behind it (sofia.bg → Приложение №3) is
// parsed offline by scripts/budget/capital_programs/sofia.ts into a single
// JSON; here we look up the район rollup and the top projects by amount.
//
// Mounted on settlement pages (/sections/:ekatte) for settlements whose
// parent obshtina is one of the 24 Sofia райони. For non-Sofia settlements
// the tile returns null silently — the hook fetches lazily so the JSON
// isn't loaded outside Sofia pages.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HardHat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useSofiaCapitalProgram } from "@/data/budget/useBudget";
import { rayonFromObshtina } from "@/data/budget/sofiaRayons";
import type { SofiaCapitalRayonRollup } from "@/data/budget/types";

const SOFIA_CAPITAL_LATEST_YEAR = 2025;

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

// Strip the район tag from project names before display — the район is
// already in the section header, repeating it in every row is noisy.
const cleanName = (raw: string): string =>
  raw
    .replace(/,?\s*район[ит]?[ие]?\s*[""„«][^""«»"]+[""»"]\s*/giu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const SofiaCapitalProjectsTile: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const rayonCode = rayonFromObshtina(obshtinaCode);
  const { data, isLoading } = useSofiaCapitalProgram(
    rayonCode ? SOFIA_CAPITAL_LATEST_YEAR : undefined,
  );

  const rayon: SofiaCapitalRayonRollup | null = useMemo(() => {
    if (!data || !rayonCode) return null;
    return data.byRayon.find((r) => r.code === rayonCode) ?? null;
  }, [data, rayonCode]);

  if (!rayonCode || isLoading || !data || !rayon) return null;
  if (rayon.projectCount === 0) return null;

  const totalEur = rayon.total.amountEur;
  const cityTotalEur = data.recapitulation.total.total.amountEur;
  const sharePct = cityTotalEur > 0 ? (100 * totalEur) / cityTotalEur : 0;
  const rayonLabel = lang === "bg" ? rayon.labelBg : rayon.labelEn;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <HardHat className="h-4 w-4" />
          {t("sofia_capital_tile_title", { rayon: rayonLabel })}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {data.fiscalYear}
            {lang === "bg" ? " г." : ""}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("sofia_capital_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("sofia_capital_project_count", { count: rayon.projectCount })}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            ·{" "}
            {t("sofia_capital_share_of_city", {
              pct: sharePct.toFixed(1),
            })}
          </span>
        </div>

        <div>
          <div className="text-xs font-medium mb-1">
            {t("sofia_capital_top_projects")}
          </div>
          <div className="space-y-1.5">
            {rayon.topProjects.map((p) => {
              const eur = p.total.amountEur;
              const widthPct =
                rayon.topProjects[0].total.amountEur > 0
                  ? (100 * eur) / rayon.topProjects[0].total.amountEur
                  : 0;
              return (
                <div
                  key={p.id}
                  className="rounded px-2 py-1 text-xs hover:bg-muted/40"
                >
                  <div className="grid grid-cols-[1fr_auto] items-baseline gap-3">
                    <span className="line-clamp-2">{cleanName(p.name)}</span>
                    <span className="tabular-nums font-medium shrink-0">
                      {compactEur(eur)}
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

        <p className="text-[11px] text-muted-foreground">
          {t("sofia_capital_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
