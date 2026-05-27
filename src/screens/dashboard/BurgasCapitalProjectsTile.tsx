// Funding-source + per-settlement breakdown of Бургас's annual Капиталова
// програма.
//
// Бургас isn't районирана (unlike Sofia/Plovdiv), so this tile leads with
// the FUNDING-SOURCE composition — state subsidy / own funds / debt /
// EU funds / other / carry-overs — instead of a райони breakdown. Then
// a per-settlement strip for the ~14% of projects that name a sub-
// village or city quarter, followed by the top-5 projects citywide.
//
// Mounted on the Burgas settlement page (EKATTE 07079) and the município
// page (/settlement/BGS04). Renders null silently when the obshtina
// code isn't BGS04.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { HardHat } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useBurgasCapitalProgram } from "@/data/budget/useBudget";

// Burgas's 2024 and 2023 budget dockets ship the capital programme
// inside a 133-page "Приложения.pdf" bundle, with multi-line wrapping
// of project descriptions that the existing parser doesn't handle —
// those years are intentionally absent from the picker. 2022 reverts
// to the older MINFIN-template XLSX, which the burgas_2022.ts parser
// reads directly.
const BURGAS_CAPITAL_YEARS = [2025, 2022] as const;
const BURGAS_CAPITAL_LATEST_YEAR = BURGAS_CAPITAL_YEARS[0];
const BURGAS_OBSHTINA = "BGS04";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

// Funding-source palette (red→orange→yellow gradient for paid-out money,
// matching the Article-53 transfer tile's family).
const FUNDING_SOURCES = [
  { key: "euFunds", i18nKey: "burgas_capital_fund_eu", colour: "#fb923c" },
  { key: "other", i18nKey: "burgas_capital_fund_other", colour: "#fdba74" },
  { key: "debt", i18nKey: "burgas_capital_fund_debt", colour: "#f43f5e" },
  {
    key: "ownFunds",
    i18nKey: "burgas_capital_fund_own",
    colour: "#fb7185",
  },
  {
    key: "stateSubsidy",
    i18nKey: "burgas_capital_fund_state",
    colour: "#fda4af",
  },
  {
    key: "carryOverCommunity",
    i18nKey: "burgas_capital_fund_carryover",
    colour: "#fcd34d",
  },
  {
    key: "carryOverDelegated",
    i18nKey: "burgas_capital_fund_carryover_delegated",
    colour: "#fde68a",
  },
] as const;

export const BurgasCapitalProjectsTile: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const enabled = obshtinaCode === BURGAS_OBSHTINA;
  const [year, setYear] = useState<number>(BURGAS_CAPITAL_LATEST_YEAR);
  const { data, isLoading } = useBurgasCapitalProgram(
    enabled ? year : undefined,
  );

  if (!enabled || isLoading || !data) return null;

  const totalEur = data.recapitulation.total.amountEur;
  const funding = data.recapitulation.funding;
  const topCityProjects = [...data.projects]
    .sort((a, b) => b.total.amountEur - a.total.amountEur)
    .slice(0, 5);
  const topSettlements = data.bySettlement.slice(0, 6);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <HardHat className="h-4 w-4" />
          {t("burgas_capital_tile_title")}
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="ml-auto text-xs font-normal bg-transparent border rounded px-1.5 py-0.5 tabular-nums cursor-pointer hover:bg-muted/40"
            aria-label={t("sofia_capital_year_picker_label")}
          >
            {BURGAS_CAPITAL_YEARS.map((y) => (
              <option key={y} value={y}>
                {y}
                {lang === "bg" ? " г." : ""}
              </option>
            ))}
          </select>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("burgas_capital_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("burgas_capital_project_count", {
              count: data.projects.length,
            })}
          </span>
        </div>

        <div>
          <div className="text-xs font-medium mb-1">
            {t("burgas_capital_by_funding")}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {FUNDING_SOURCES.map(({ key, i18nKey, colour }) => {
              const money = funding[key];
              const eur = money.amountEur;
              if (eur === 0) return null;
              const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
              return (
                <div
                  key={key}
                  className="rounded border bg-card p-2 text-xs"
                  title={`${money.amount.toLocaleString("bg-BG")} лв.`}
                >
                  <div
                    className="h-1 rounded-full mb-1"
                    style={{ backgroundColor: colour }}
                  />
                  <div className="text-muted-foreground line-clamp-2">
                    {t(i18nKey)}
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

        {topSettlements.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("burgas_capital_by_settlement")}
            </div>
            <div className="space-y-1">
              {topSettlements.map((s) => {
                const maxEur = topSettlements[0]?.total.amountEur ?? 0;
                const widthPct =
                  maxEur > 0 ? (100 * s.total.amountEur) / maxEur : 0;
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
                        {t("burgas_capital_project_count_compact", {
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
              {t("burgas_capital_top_city_projects")}
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
          {t("burgas_capital_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
