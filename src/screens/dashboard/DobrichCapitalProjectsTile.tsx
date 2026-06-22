// Funding-source breakdown of Добрич's annual капиталова програма.
//
// Dobrich-grad is a SINGLE-settlement município (DOB28, EKATTE 72624) —
// the city of Dobrich only; the surrounding 68 villages are a separate
// "Добрич-селска" rural município (DOB15). So no per-village strip;
// the tile leads with a funding-source mini-grid + top 5 projects.
//
// Source is an inline HTML table on dobrich.bg, scraped server-side
// by scripts/budget/capital_programs/dobrich.ts (no OCR needed).

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
import { useDobrichCapitalProgram } from "@/data/budget/useBudget";

// 2024 + 2025 currently on disk; 2023 and earlier aren't on dobrich.bg.
const DOBRICH_CAPITAL_YEARS = [2025, 2024] as const;
const DOBRICH_CAPITAL_LATEST_YEAR = DOBRICH_CAPITAL_YEARS[0];
const DOBRICH_OBSHTINA = "DOB28";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v.toLocaleString("en-US")}`;
};

const FUNDING_PALETTE: Record<string, string> = {
  OWN_FUNDS: "#fb7185",
  TARGETED_SUBSIDY: "#fda4af",
  TRANSITIONAL_BALANCES: "#fcd34d",
  EU_PROJECTS: "#fb923c",
  STATE_TRANSFER: "#fdba74",
  INVESTMENT_PROGRAMME: "#f97316",
};

const FUNDING_I18N: Record<string, string> = {
  OWN_FUNDS: "dobrich_capital_fund_own",
  TARGETED_SUBSIDY: "dobrich_capital_fund_targeted",
  TRANSITIONAL_BALANCES: "dobrich_capital_fund_transitional",
  EU_PROJECTS: "dobrich_capital_fund_eu",
  STATE_TRANSFER: "dobrich_capital_fund_state",
  INVESTMENT_PROGRAMME: "dobrich_capital_fund_investment",
};

export const DobrichCapitalProjectsTile: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const enabled = obshtinaCode === DOBRICH_OBSHTINA;
  const [year, setYear] = useState<number>(DOBRICH_CAPITAL_LATEST_YEAR);
  const { data, isLoading } = useDobrichCapitalProgram(
    enabled ? year : undefined,
  );

  if (!enabled || isLoading || !data) return null;

  const totalEur = data.recapitulation.total.amountEur;
  const topProjects = [...data.projects]
    .sort((a, b) => b.total.amountEur - a.total.amountEur)
    .slice(0, 5);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <HardHat className="h-4 w-4" />
          {t("dobrich_capital_tile_title")}
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
              {DOBRICH_CAPITAL_YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                  {lang === "bg" ? " г." : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("dobrich_capital_tile_intro")}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("dobrich_capital_project_count", {
              count: data.projectCount ?? data.projects.length,
            })}
          </span>
        </div>

        {data.byFundingSource.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("dobrich_capital_by_funding")}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {data.byFundingSource.map((f) => {
                const eur = f.total.amountEur;
                if (eur === 0) return null;
                const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
                const colour = FUNDING_PALETTE[f.code] ?? "#fde68a";
                const label = FUNDING_I18N[f.code];
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
                      {label ? t(label) : f.code}
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

        {topProjects.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("dobrich_capital_top_projects")}
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
          {t("dobrich_capital_tile_caveat")}
        </p>
      </CardContent>
    </Card>
  );
};
