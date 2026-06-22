// Plan-vs-actual budget execution (касово изпълнение по ЕБК) for the handful
// of общини that publish a MINFIN B3 report to data.egov.bg (currently Русе,
// Николаево). One generic tile serves every covered муни — the index gates
// which obshtinaCode it activates for, mirroring the capital-programme tiles.
//
// The revenue side is OWN revenue (собствени приходи: local taxes, fees,
// property income) — it funds only part of spending; the rest is state
// transfers + carry-over, which is why expense ≫ revenue. The caption says so.

import { FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { NativeSelect } from "@/components/ui/native-select";
import {
  useMunicipalExecutionIndex,
  useMunicipalExecution,
} from "@/data/budget/useBudget";
import type { MunicipalExecutionSide } from "@/data/budget/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${Math.round(v).toLocaleString("en-US")}`;
};

// Execution-rate colour: at/over plan = green, moderate underspend = amber,
// deep underspend = red. Applied to the % badge + the bar fill.
const pctTone = (pct: number | null): string => {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 95) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 80) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
};
const barTone = (pct: number | null): string => {
  if (pct === null) return "bg-muted-foreground/40";
  if (pct >= 95) return "bg-emerald-500/70";
  if (pct >= 80) return "bg-amber-400/70";
  return "bg-red-500/70";
};

const SideHeadline: FC<{ label: string; side: MunicipalExecutionSide }> = ({
  label,
  side,
}) => (
  <div className="rounded border p-2.5">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="flex items-baseline gap-2 flex-wrap">
      <span className="text-xl font-semibold tabular-nums">
        {compactEur(side.actual.amountEur)}
      </span>
      {side.executionPct !== null && (
        <span
          className={`text-xs font-medium tabular-nums ${pctTone(side.executionPct)}`}
        >
          {side.executionPct}%
        </span>
      )}
    </div>
    <div className="text-[11px] text-muted-foreground tabular-nums">
      {compactEur(side.plan.amountEur)}
    </div>
  </div>
);

export const MunicipalBudgetExecutionTile: FC<{ obshtinaCode: string }> = ({
  obshtinaCode,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const { data: index } = useMunicipalExecutionIndex();
  const entry = index?.municipalities.find((m) => m.obshtina === obshtinaCode);
  const years = entry?.years ?? [];
  const latest = years.length ? years[years.length - 1] : undefined;
  // Default to the latest full fiscal year so the headline isn't a mid-year
  // partial; the current partial year stays selectable in the dropdown.
  const defaultYear = entry?.latestFullYear ?? latest;
  const [year, setYear] = useState<number | undefined>(undefined);
  const activeYear = year ?? defaultYear;
  const { data } = useMunicipalExecution(entry?.muniSlug, activeYear);

  if (!entry || !data) return null;

  const topExpense = data.expense.byParagraph.slice(0, 6);
  const maxExpense = topExpense[0]?.actual.amountEur ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Scale className="h-4 w-4" />
          {t("muni_exec_tile_title")}
          <NativeSelect
            value={activeYear}
            onChange={(e) => setYear(Number(e.target.value))}
            wrapperClassName="ml-auto"
            className="text-xs font-normal bg-transparent border rounded px-1.5 py-0.5 tabular-nums cursor-pointer hover:bg-muted/40"
            aria-label={t("muni_exec_year_picker_label")}
          >
            {[...years].reverse().map((y) => (
              <option key={y} value={y}>
                {y}
                {lang === "bg" ? " г." : ""}
              </option>
            ))}
          </NativeSelect>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {data.period.isFullYear
            ? t("muni_exec_tile_intro")
            : t("muni_exec_tile_intro_partial", {
                period: data.period.labelBg,
              })}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <SideHeadline
            label={t("muni_exec_own_revenue")}
            side={data.revenue}
          />
          <SideHeadline label={t("muni_exec_expense")} side={data.expense} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          {t("muni_exec_plan_actual_note")}
        </p>

        {topExpense.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">
              {t("muni_exec_where_spent")}
            </div>
            <div className="space-y-1">
              {topExpense.map((p) => {
                const widthPct =
                  maxExpense > 0 ? (100 * p.actual.amountEur) / maxExpense : 0;
                return (
                  <div
                    key={p.code}
                    className="rounded px-2 py-1 text-xs hover:bg-muted/40"
                  >
                    <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3">
                      <span className="line-clamp-1">{p.name}</span>
                      <span className="tabular-nums font-medium shrink-0">
                        {compactEur(p.actual.amountEur)}
                      </span>
                      <span
                        className={`tabular-nums w-12 text-right shrink-0 ${pctTone(p.executionPct)}`}
                      >
                        {p.executionPct !== null ? `${p.executionPct}%` : "—"}
                      </span>
                    </div>
                    <div
                      className={`h-0.5 mt-1 rounded-full ${barTone(p.executionPct)}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          {t("muni_exec_tile_caveat")}{" "}
          <a
            href={data.source.datasetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            data.egov.bg
          </a>
        </p>
      </CardContent>
    </Card>
  );
};
