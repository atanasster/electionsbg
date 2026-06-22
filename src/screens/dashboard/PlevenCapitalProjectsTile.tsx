// Funding-source + per-settlement breakdown of Плевен's annual Капиталова
// програма (Приложения №4 + №10А to the council's budget decision).
//
// Плевен isn't районирана. The tile leads with the FUNDING-SOURCE
// composition (преходни остатъци / целеви субсидии / други бюджетни /
// EU projects), then a per-settlement strip surfacing the city + outlying
// villages where projects name a "гр./с." location, and finally the top 5
// city-wide projects by amount.
//
// Mounted on the Pleven settlement page (EKATTE 56722) and the município
// page (/settlement/PVN24). Renders null silently when the obshtina code
// isn't PVN24.

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
import { usePlevenCapitalProgram } from "@/data/budget/useBudget";

const PLEVEN_CAPITAL_YEARS = [2025, 2024, 2023, 2022] as const;
const PLEVEN_CAPITAL_LATEST_YEAR = PLEVEN_CAPITAL_YEARS[0];
const PLEVEN_OBSHTINA = "PVN24";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

// Funding-source palette mirrors Burgas (red→orange→yellow gradient).
const FUNDING_PALETTE: Record<string, string> = {
  EU_PROJECTS: "#fb923c",
  TARGETED_SUBSIDY: "#fda4af",
  OTHER_BUDGET: "#fb7185",
  TRANSITIONAL_BALANCES: "#fcd34d",
  UNSPECIFIED_SOURCE: "#fde68a",
};

const FUNDING_I18N: Record<string, string> = {
  EU_PROJECTS: "pleven_capital_fund_eu",
  TARGETED_SUBSIDY: "pleven_capital_fund_targeted",
  OTHER_BUDGET: "pleven_capital_fund_other",
  TRANSITIONAL_BALANCES: "pleven_capital_fund_transitional",
  UNSPECIFIED_SOURCE: "pleven_capital_fund_unspecified",
};

export const PlevenCapitalProjectsTile: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const enabled = obshtinaCode === PLEVEN_OBSHTINA;
  const [year, setYear] = useState<number>(PLEVEN_CAPITAL_LATEST_YEAR);
  const { data, isLoading } = usePlevenCapitalProgram(
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
          {t("pleven_capital_tile_title")}
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
              {PLEVEN_CAPITAL_YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                  {lang === "bg" ? " г." : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("pleven_capital_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("pleven_capital_project_count", {
              count: data.projectCount ?? data.projects.length,
            })}
          </span>
        </div>

        {data.byFundingSource.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("pleven_capital_by_funding")}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {data.byFundingSource.map((f) => {
                const eur = f.total.amountEur;
                if (eur === 0) return null;
                const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
                const colour = FUNDING_PALETTE[f.code] ?? "#fde68a";
                const label =
                  FUNDING_I18N[f.code] ?? "pleven_capital_fund_unspecified";
                return (
                  <div
                    key={f.code}
                    className="rounded border bg-card p-2 text-xs"
                    title={`${f.total.amount.toLocaleString("bg-BG")} лв.`}
                  >
                    <div
                      className="h-1 rounded-full mb-1"
                      style={{ backgroundColor: colour }}
                    />
                    <div className="text-muted-foreground line-clamp-2">
                      {t(label)}
                    </div>
                    <div className="font-medium tabular-nums">
                      {compactEur(eur)}
                    </div>
                    <div className="text-muted-foreground tabular-nums text-[10px]">
                      {pct >= 0.5 ? `${pct.toFixed(1)}%` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {topSettlements.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("pleven_capital_by_settlement")}
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
                        {t("pleven_capital_project_count_compact", {
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
              {t("pleven_capital_top_projects")}
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
          {t("pleven_capital_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
