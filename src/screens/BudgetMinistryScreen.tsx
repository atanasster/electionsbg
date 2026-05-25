// /budget/ministry/:id — one first-level spending unit's appropriations from
// the State Budget Law: per-year revenue / expenditure / balance, its program
// budget, and its public-procurement footprint. When the unit's annual
// program-budget execution report has been ingested, the headline cards and
// the per-year table also surface the отчет (executed) alongside the
// law-planned figure.
//
// Layout: hero (latest year + YoY delta) → multi-year expenditure trend chart
// (planned + executed lines) → compact per-year history table → programs →
// procurement. The hero answers "where is this ministry today?", the chart
// answers "is it growing?", the table is the audit-trail for the prior years.
//
// Performance: the screen makes ONE fetch — the pre-sliced
// ministries/<nodeId>.json rollup — instead of pulling every year's
// whole-corpus reconciliation files.

import { FC, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  Coins,
  Landmark,
  Scale,
  Receipt,
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Title } from "@/ux/Title";
import { StatCard } from "./dashboard/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { MinistryPersonnelBlock } from "./components/budget/MinistryPersonnelBlock";
import { Sparkline } from "@/ux/Sparkline";
import { formatEur } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import type {
  MinistryProcurement,
  MinistryRollupYear,
  MinistrySeriesExecution,
} from "@/data/budget/types";

const numFmt = new Intl.NumberFormat("bg-BG");

const compactEur = (v: number): string => {
  if (Math.abs(v) >= 1_000_000_000)
    return `€${(v / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(v) >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (Math.abs(v) >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return formatEur(v);
};

const expenditureOf = (y: MinistryRollupYear): number | null =>
  y.expenditure?.amountEur ?? null;
const revenueOf = (y: MinistryRollupYear): number | null =>
  y.revenue?.amountEur ?? null;
const executedExpOf = (y: MinistryRollupYear): number | null =>
  y.execution?.expenditure?.executed?.amountEur ?? null;
// Planned balance is published as 0 for years where the budget law set no
// separate self-financing target; without an ingested execution report a 0
// here means "unknown", not "balanced". Treat it as missing.
const balanceOf = (y: MinistryRollupYear): number | null => {
  const v = y.balance?.amountEur;
  return v == null || v === 0 ? null : v;
};
const executionPctOf = (
  series: MinistrySeriesExecution | null | undefined,
): number | null => {
  if (!series?.executed || !series.amended || series.amended.amountEur === 0)
    return null;
  return (series.executed.amountEur / series.amended.amountEur) * 100;
};

// Year-over-year delta as a small inline chip — "▲ €1.2M (+12%) vs 2024".
// Returns null when either side is missing (a ministry's first year, or a gap
// like 2021).
const YoyDelta: FC<{
  current: number | null;
  prior: number | null;
  priorYear: number | null;
  invertColor?: boolean; // for expenditure: ↑ is rose, ↓ is emerald
  // Drop the (%) part — useful for balance/deficit where the prior-year
  // baseline can be a near-zero or sign-flipping number that makes the
  // percentage arithmetic meaningful only to a CFO.
  omitPct?: boolean;
}> = ({ current, prior, priorYear, invertColor, omitPct }) => {
  const { t } = useTranslation();
  if (current == null || prior == null || prior === 0 || priorYear == null)
    return null;
  const diff = current - prior;
  if (diff === 0) return null;
  const pct = (diff / Math.abs(prior)) * 100;
  const up = diff > 0;
  const positiveIsGood = invertColor ? !up : up;
  const cls = positiveIsGood
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={`mt-1 flex items-center gap-1 text-xs tabular-nums ${cls}`}>
      <Icon className="h-3 w-3 shrink-0" />
      <span>
        {up ? "+" : "−"}
        {compactEur(Math.abs(diff))}
        {omitPct ? null : (
          <>
            {" ("}
            {up ? "+" : "−"}
            {Math.abs(pct).toFixed(1)}%)
          </>
        )}
      </span>
      <span className="text-muted-foreground">
        {t("budget_ministry_vs_year") || "vs"} {priorYear}
      </span>
    </div>
  );
};

const SkeletonCard: FC = () => (
  <div className="rounded-xl border bg-card p-4 shadow-sm animate-pulse h-[130px]">
    <div className="h-3 w-24 bg-muted rounded mb-3" />
    <div className="h-7 w-32 bg-muted rounded mb-2" />
    <div className="h-3 w-20 bg-muted rounded" />
  </div>
);

// Three big stat cards for the most recent year with data. Each card carries
// the headline number, a YoY delta vs. the prior year in the series, and (for
// revenue/expenditure) a small sparkline of the trailing trend so the eye
// gets recent direction without scrolling to the chart.
const HeroStrip: FC<{ years: MinistryRollupYear[] }> = ({ years }) => {
  const { t } = useTranslation();

  const latest = [...years]
    .reverse()
    .find((y) => y.revenue || y.expenditure || y.balance);
  if (!latest) return null;
  const latestIdx = years.indexOf(latest);
  const prior = latestIdx > 0 ? years[latestIdx - 1] : null;

  const revSeries = years.map(revenueOf).filter((v): v is number => v != null);
  const expSeries = years
    .map(expenditureOf)
    .filter((v): v is number => v != null);

  const latestBal = balanceOf(latest);
  const priorBal = prior ? balanceOf(prior) : null;
  const deficit = latestBal != null && latestBal < 0;
  const expExec = latest.execution?.expenditure ?? null;
  const expExecPct = executionPctOf(expExec);

  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
      <StatCard
        label={`${t("budget_series_revenue") || "Revenue"} · ${latest.fiscalYear}`}
      >
        <div className="flex items-baseline gap-2">
          <Coins className="h-5 w-5 text-emerald-600 shrink-0" />
          <span className="text-xl font-bold tabular-nums break-words">
            {latest.revenue ? formatEur(latest.revenue.amountEur) : "—"}
          </span>
        </div>
        <YoyDelta
          current={revenueOf(latest)}
          prior={prior ? revenueOf(prior) : null}
          priorYear={prior?.fiscalYear ?? null}
        />
        {revSeries.length >= 2 ? (
          <Sparkline
            values={revSeries}
            color="#059669"
            className="mt-1 h-6 text-emerald-600"
            ariaLabel={t("budget_series_revenue") || "Revenue"}
          />
        ) : null}
      </StatCard>

      <StatCard
        label={`${t("budget_series_expenditure") || "Expenditure"} · ${latest.fiscalYear}`}
      >
        <div className="flex items-baseline gap-2">
          <Landmark className="h-5 w-5 text-rose-600 shrink-0" />
          <span className="text-xl font-bold tabular-nums break-words">
            {latest.expenditure ? formatEur(latest.expenditure.amountEur) : "—"}
          </span>
        </div>
        <YoyDelta
          current={expenditureOf(latest)}
          prior={prior ? expenditureOf(prior) : null}
          priorYear={prior?.fiscalYear ?? null}
          invertColor
        />
        {expSeries.length >= 2 ? (
          <Sparkline
            values={expSeries}
            color="#e11d48"
            className="mt-1 h-6 text-rose-600"
            ariaLabel={t("budget_series_expenditure") || "Expenditure"}
          />
        ) : null}
      </StatCard>

      {/* The third card morphs by what's available for the latest year:
          execution % when an отчет has been ingested, otherwise the planned
          balance (surplus or deficit). */}
      {expExec?.executed && expExec.amended && expExecPct != null ? (
        <StatCard
          label={`${t("budget_ministry_execution_label") || "Execution"} · ${latest.fiscalYear}`}
        >
          <div className="flex items-baseline gap-2">
            <Scale className="h-5 w-5 text-primary shrink-0" />
            <span className="text-xl font-bold tabular-nums break-words">
              {expExecPct.toFixed(1)}%
            </span>
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {compactEur(expExec.executed.amountEur)}{" "}
            <span className="opacity-70">
              {t("budget_ministries_of_amended") || "of amended"}{" "}
              {compactEur(expExec.amended.amountEur)}
            </span>
          </div>
        </StatCard>
      ) : (
        <StatCard
          label={`${
            latestBal == null
              ? t("budget_balance") || "Budget balance"
              : deficit
                ? t("budget_deficit") || "Budget deficit"
                : t("budget_surplus") || "Budget surplus"
          } · ${latest.fiscalYear}`}
        >
          <div className="flex items-baseline gap-2">
            <Scale
              className={`h-5 w-5 shrink-0 ${
                latestBal == null
                  ? "text-muted-foreground"
                  : deficit
                    ? "text-rose-600"
                    : "text-emerald-600"
              }`}
            />
            <span className="text-xl font-bold tabular-nums break-words">
              {latestBal != null ? formatEur(Math.abs(latestBal)) : "—"}
            </span>
          </div>
          <YoyDelta
            current={latestBal}
            prior={priorBal}
            priorYear={prior?.fiscalYear ?? null}
            omitPct
          />
        </StatCard>
      )}
    </div>
  );
};

interface TrendDatum {
  fiscalYear: number;
  planned: number | null;
  executed: number | null;
}

// Multi-year expenditure trend: planned (always) + executed (sparse, only the
// 5–10 ministries with ingested execution reports). Time-typed x-axis so a
// missing year (e.g. 2021's caretaker gap) shows as an honest gap rather than
// collapsing into adjacent ticks.
const ExpenditureTrendChart: FC<{ years: MinistryRollupYear[] }> = ({
  years,
}) => {
  const { t } = useTranslation();
  const data = useMemo<TrendDatum[]>(
    () =>
      years.map((y) => ({
        fiscalYear: y.fiscalYear,
        planned: expenditureOf(y),
        executed: executedExpOf(y),
      })),
    [years],
  );
  const plannedPoints = data.filter((d) => d.planned != null).length;
  const executedPoints = data.filter((d) => d.executed != null).length;
  if (plannedPoints < 2) return null;
  const firstYear = data[0].fiscalYear;
  const lastYear = data[data.length - 1].fiscalYear;
  const xTicks: number[] = [];
  for (let y = firstYear; y <= lastYear; y++) xTicks.push(y);

  return (
    <Card className="my-4" data-og="ministry-trend">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          {t("budget_ministry_trend_title") || "Expenditure trend"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {executedPoints > 0
            ? t("budget_ministry_trend_subtitle_with_execution") ||
              "Planned appropriations (State Budget Law) and actual execution per fiscal year."
            : t("budget_ministry_trend_subtitle_planned_only") ||
              "Planned appropriations (State Budget Law) per fiscal year. Execution is published in the year-end report and is not yet ingested for this unit."}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div style={{ height: 220, width: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                className="stroke-border"
              />
              <XAxis
                type="number"
                dataKey="fiscalYear"
                domain={[firstYear, lastYear]}
                ticks={xTicks}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                className="fill-muted-foreground"
                allowDecimals={false}
              />
              <YAxis
                tickFormatter={compactEur}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                className="fill-muted-foreground"
                width={56}
              />
              <Tooltip
                cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload as TrendDatum;
                  return (
                    <div className="rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm text-xs space-y-0.5">
                      <div className="font-semibold">{d.fiscalYear}</div>
                      <div className="tabular-nums text-rose-600">
                        {t("budget_ministry_trend_planned") || "Planned"}:{" "}
                        {d.planned != null ? formatEur(d.planned) : "—"}
                      </div>
                      <div className="tabular-nums text-primary">
                        {t("budget_ministry_trend_executed") || "Executed"}:{" "}
                        {d.executed != null ? formatEur(d.executed) : "—"}
                      </div>
                      {d.planned != null && d.executed != null
                        ? (() => {
                            const pct = (d.executed / d.planned) * 100;
                            return (
                              <div className="tabular-nums text-muted-foreground">
                                {t("budget_ministry_trend_ratio") ||
                                  "Execution"}
                                : {pct.toFixed(1)}%
                              </div>
                            );
                          })()
                        : null}
                    </div>
                  );
                }}
              />
              <Line
                type="monotone"
                dataKey="planned"
                stroke="#e11d48"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={{ r: 2.5, fill: "#e11d48" }}
                activeDot={{ r: 5 }}
                connectNulls={false}
                name={t("budget_ministry_trend_planned") || "Planned"}
              />
              <Line
                type="monotone"
                dataKey="executed"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "hsl(var(--primary))" }}
                activeDot={{ r: 5 }}
                connectNulls={false}
                name={t("budget_ministry_trend_executed") || "Executed"}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4 border-t-2 border-dashed"
              style={{ borderColor: "#e11d48" }}
            />
            {t("budget_ministry_trend_planned") || "Planned"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 bg-primary" />
            {t("budget_ministry_trend_executed") || "Executed"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

// Per-year audit-trail table. Replaces the wall of repeated three-tile blocks
// the screen had before. Columns are: FY, Revenue, Planned expenditure,
// Executed expenditure, Execution %, Balance (surplus / deficit). Empty cells
// are em-dashes — most ministries today have no execution data.
const HistoryTable: FC<{ years: MinistryRollupYear[] }> = ({ years }) => {
  const { t } = useTranslation();
  if (years.length === 0) return null;
  return (
    <Card className="my-4" data-og="ministry-history">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Scale className="h-4 w-4" />
          {t("budget_ministry_history_title") || "Year-by-year"}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-muted-foreground uppercase tracking-wide">
              <th className="font-medium py-2 pr-3">
                {t("budget_fy_heading") || "Fiscal year"}
              </th>
              <th className="font-medium py-2 px-3 text-right">
                {t("budget_series_revenue") || "Revenue"}
              </th>
              <th className="font-medium py-2 px-3 text-right">
                {t("budget_ministry_col_planned") || "Planned expenditure"}
              </th>
              <th className="font-medium py-2 px-3 text-right">
                {t("budget_ministry_col_executed") || "Executed"}
              </th>
              <th className="font-medium py-2 px-3 text-right">
                {t("budget_ministry_col_execution_pct") || "Execution %"}
              </th>
              <th className="font-medium py-2 pl-3 text-right">
                {t("budget_ministry_col_balance") || "Balance"}
              </th>
            </tr>
          </thead>
          <tbody>
            {[...years].reverse().map((y) => {
              const expExec = y.execution?.expenditure ?? null;
              const pct = executionPctOf(expExec);
              const bal = balanceOf(y);
              const balDeficit = bal != null && bal < 0;
              return (
                <tr
                  key={y.fiscalYear}
                  className="border-t border-border/40 align-baseline"
                >
                  <td className="py-2 pr-3 font-medium">{y.fiscalYear}</td>
                  <td className="py-2 px-3 text-right">
                    {y.revenue ? formatEur(y.revenue.amountEur) : "—"}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {y.expenditure ? formatEur(y.expenditure.amountEur) : "—"}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {expExec?.executed
                      ? formatEur(expExec.executed.amountEur)
                      : "—"}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {pct != null ? `${pct.toFixed(1)}%` : "—"}
                  </td>
                  <td
                    className={`py-2 pl-3 text-right ${
                      balDeficit ? "text-rose-600 dark:text-rose-400" : ""
                    }`}
                  >
                    {bal != null
                      ? `${balDeficit ? "−" : ""}${formatEur(Math.abs(bal))}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
};

// Categorical palette for program lines. Eight hues, all with enough contrast
// against the cream/dark page backgrounds; cycles if a ministry runs more than
// eight programs (rare — most cap at four).
const PROGRAM_COLORS = [
  "#059669", // emerald-600
  "#e11d48", // rose-600
  "#0284c7", // sky-600
  "#d97706", // amber-600
  "#7c3aed", // violet-600
  "#0d9488", // teal-600
  "#db2777", // pink-600
  "#ea580c", // orange-600
];

// Multi-line trend chart for the unit's programs. Groups programs by stable
// nodeId so a program with a slightly tweaked label across years still
// resolves to one line. Programs beyond the top eight (by max amount in any
// year) collapse into "Other" so the chart stays legible.
const ProgramTrendChart: FC<{
  years: MinistryRollupYear[];
  lang: "bg" | "en";
}> = ({ years, lang }) => {
  const { t } = useTranslation();
  const { data, programs } = useMemo(() => {
    const meta = new Map<
      string,
      { nodeId: string; name: string; max: number }
    >();
    years.forEach((y) =>
      y.programs.forEach((p) => {
        const name = lang === "en" && p.nameEn ? p.nameEn : p.nameBg;
        const v = p.planned?.amountEur ?? 0;
        const prev = meta.get(p.nodeId);
        if (!prev) meta.set(p.nodeId, { nodeId: p.nodeId, name, max: v });
        else if (v > prev.max) prev.max = v;
      }),
    );
    const ordered = [...meta.values()].sort((a, b) => b.max - a.max);
    const TOP = 8;
    const top = ordered.slice(0, TOP);
    const rest = ordered.slice(TOP).map((p) => p.nodeId);
    const restKey = "__other__";
    const programs = [
      ...top.map((p, i) => ({
        key: p.nodeId,
        name: p.name,
        color: PROGRAM_COLORS[i % PROGRAM_COLORS.length],
      })),
      ...(rest.length > 0
        ? [
            {
              key: restKey,
              name: t("budget_ministry_program_other") || "Other",
              color: "#94a3b8",
            },
          ]
        : []),
    ];
    const data = years.map((y) => {
      const row: Record<string, number | null> & { fiscalYear: number } = {
        fiscalYear: y.fiscalYear,
      };
      programs.forEach((p) => (row[p.key] = null));
      let other = 0;
      let otherHas = false;
      y.programs.forEach((p) => {
        const v = p.planned?.amountEur ?? null;
        if (v == null) return;
        if (rest.includes(p.nodeId)) {
          other += v;
          otherHas = true;
        } else {
          row[p.nodeId] = v;
        }
      });
      if (rest.length > 0 && otherHas) row[restKey] = other;
      return row;
    });
    return { data, programs };
  }, [years, lang, t]);

  if (data.length < 2 || programs.length === 0) return null;
  const firstYear = data[0].fiscalYear;
  const lastYear = data[data.length - 1].fiscalYear;
  const xTicks: number[] = [];
  for (let y = firstYear; y <= lastYear; y++) xTicks.push(y);

  return (
    <div className="pb-3 mb-3 border-b border-border/40">
      <div style={{ height: 240, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              className="stroke-border"
            />
            <XAxis
              type="number"
              dataKey="fiscalYear"
              domain={[firstYear, lastYear]}
              ticks={xTicks}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              className="fill-muted-foreground"
              allowDecimals={false}
            />
            <YAxis
              tickFormatter={compactEur}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              className="fill-muted-foreground"
              width={56}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const rows = programs
                  .map((p) => {
                    const v = payload.find((pl) => pl.dataKey === p.key)
                      ?.value as number | null | undefined;
                    return { p, v };
                  })
                  .filter((r) => r.v != null);
                if (rows.length === 0) return null;
                return (
                  <div className="rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm text-xs space-y-0.5 max-w-xs">
                    <div className="font-semibold">{label}</div>
                    {rows.map(({ p, v }) => (
                      <div
                        key={p.key}
                        className="flex items-baseline gap-1.5 tabular-nums"
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-sm shrink-0"
                          style={{ background: p.color }}
                        />
                        <span className="truncate text-muted-foreground">
                          {p.name}
                        </span>
                        <span className="ml-auto pl-2 shrink-0">
                          {formatEur(v as number)}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {programs.map((p) => (
              <Line
                key={p.key}
                type="monotone"
                dataKey={p.key}
                stroke={p.color}
                strokeWidth={2}
                dot={{ r: 2.5, fill: p.color }}
                activeDot={{ r: 5 }}
                connectNulls={false}
                name={p.name}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {programs.map((p) => (
          <span
            key={p.key}
            className="inline-flex items-baseline gap-1.5 max-w-full"
            title={p.name}
          >
            <span
              className="inline-block h-0.5 w-3 shrink-0"
              style={{ background: p.color }}
            />
            <span className="truncate">{p.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

// The unit's program budget — the policy-area / program appropriations the
// State Budget Law sets, per fiscal year, as a proportional bar list.
const ProgramBlock: FC<{ years: MinistryRollupYear[]; lang: "bg" | "en" }> = ({
  years,
  lang,
}) => {
  const { t } = useTranslation();
  const withPrograms = years.filter((y) => y.programs.length > 0);
  if (withPrograms.length === 0) return null;
  return (
    <Card className="my-4" data-og="ministry-programs">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {t("budget_ministry_programs_title") || "Budget by program"}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ProgramTrendChart years={withPrograms} lang={lang} />
        {withPrograms.map((py) => {
          const max = Math.max(
            1,
            ...py.programs.map((p) => p.planned?.amountEur ?? 0),
          );
          return (
            <div
              key={py.fiscalYear}
              className="py-2 border-b border-border/40 last:border-b-0"
            >
              <div className="text-xs font-bold tabular-nums mb-1.5">
                {py.fiscalYear}
              </div>
              <ul className="space-y-1.5">
                {py.programs.map((p) => {
                  const v = p.planned?.amountEur ?? 0;
                  const ex = p.execution;
                  const execShare =
                    ex && ex.executed && ex.amended && ex.amended.amountEur > 0
                      ? Math.min(
                          100,
                          (ex.executed.amountEur / ex.amended.amountEur) * 100,
                        )
                      : 0;
                  return (
                    <li key={p.nodeId} className="text-xs">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-muted-foreground">
                          {lang === "en" && p.nameEn ? p.nameEn : p.nameBg}
                        </span>
                        <span className="tabular-nums shrink-0">
                          {formatEur(v)}
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 rounded bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary/25"
                          style={{ width: "100%" }}
                        >
                          {ex && ex.executed ? (
                            <div
                              className="h-full rounded bg-primary/80"
                              style={{ width: `${execShare}%` }}
                            />
                          ) : (
                            <div
                              className="h-full rounded bg-primary/60"
                              style={{ width: `${(v / max) * 100}%` }}
                            />
                          )}
                        </div>
                      </div>
                      {ex && ex.executed && ex.variancePct != null ? (
                        <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                          {t("budget_ministries_executed") || "executed"}{" "}
                          {formatEur(ex.executed.amountEur)}
                          {ex.amended && ex.amended.amountEur > 0 ? (
                            <>
                              {" "}
                              (
                              {(
                                (ex.executed.amountEur / ex.amended.amountEur) *
                                100
                              ).toFixed(1)}
                              %{" "}
                              <span className="opacity-70">
                                {t("budget_ministries_of_amended") ||
                                  "of amended"}
                              </span>
                              )
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

// Phase 4 — the spending unit's public-procurement footprint, linking the
// budget pillar through to the contracts it actually awarded. The "X% of
// cumulative appropriations" line puts the procurement number in context:
// reading €1.2B in contracts is meaningful only against the €5B in
// expenditure the same unit moved over the same window.
const ProcurementBlock: FC<{
  procurement: MinistryProcurement;
  years: MinistryRollupYear[];
}> = ({ procurement, years }) => {
  const { t } = useTranslation();

  // Cumulative expenditure across the years we have data for. Prefer the
  // executed figure when ingested; fall back to the law-planned figure so
  // we still get a denominator for years pre-execution-report. Years with
  // no expenditure (revenue-only units, in-progress no-law years) drop out.
  const expenditureSum = years.reduce((sum, y) => {
    const exec = y.execution?.expenditure?.executed?.amountEur;
    const planned = y.expenditure?.amountEur;
    return sum + (exec ?? planned ?? 0);
  }, 0);
  const sharePct =
    expenditureSum > 0 ? (procurement.totalEur / expenditureSum) * 100 : null;
  const yearsWithFigures = years.filter(
    (y) => y.execution?.expenditure?.executed || y.expenditure,
  );
  const firstYear = yearsWithFigures[0]?.fiscalYear;
  const lastYear = yearsWithFigures[yearsWithFigures.length - 1]?.fiscalYear;

  return (
    <Card className="my-4" data-og="ministry-procurement">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          {t("budget_ministry_procurement_title") || "Public procurement"}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <div className="flex items-baseline gap-2">
          <Coins className="h-5 w-5 text-amber-600 shrink-0" />
          <span className="text-xl font-bold tabular-nums">
            {formatEur(procurement.totalEur)}
          </span>
          <span className="text-sm text-muted-foreground">
            {t("budget_ministry_procurement_across") || "across"}{" "}
            {numFmt.format(procurement.contractCount)}{" "}
            {t("budget_ministry_procurement_contracts") || "contracts"}
          </span>
        </div>
        {sharePct != null && firstYear && lastYear ? (
          <div className="text-xs text-muted-foreground tabular-nums">
            {(
              t("budget_ministry_procurement_share") ||
              "≈ {{pct}}% of this unit's cumulative expenditure ({{first}}–{{last}})"
            )
              .replace("{{pct}}", sharePct.toFixed(1))
              .replace("{{first}}", String(firstYear))
              .replace("{{last}}", String(lastYear))}
          </div>
        ) : null}
        {procurement.mpConnectedContractorCount > 0 ? (
          <div className="flex items-baseline gap-1.5 text-sm">
            <Users className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="tabular-nums font-medium">
              {numFmt.format(procurement.mpConnectedContractorCount)}
            </span>
            <span className="text-muted-foreground">
              {t("budget_ministry_procurement_mp") ||
                "MP-connected contractor(s) paid by this unit"}
            </span>
          </div>
        ) : null}
        <Link
          to={`/awarder/${procurement.eik}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t("budget_ministry_procurement_link") ||
            "View this unit's procurement contracts"}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
};

export const BudgetMinistryScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useBudgetMinistryRollup(id);
  const lang = i18n.language === "bg" ? "bg" : "en";

  const backLink = (
    <Link
      to="/budget"
      className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground hover:underline"
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      {t("budget_index_title") || "State budget"}
    </Link>
  );

  if (isLoading) {
    return (
      <section className="my-4 space-y-4">
        {backLink}
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="my-4 space-y-4">
        {backLink}
        <p className="text-sm text-muted-foreground">
          {t("budget_ministry_not_found") ||
            "No budget-law data found for this spending unit."}
        </p>
      </section>
    );
  }

  const name = lang === "bg" ? data.nameBg : data.nameEn || data.nameBg;

  return (
    <>
      <Title description={`${name} — state budget appropriations`}>
        {name}
      </Title>
      <section aria-label={name} className="my-4">
        {backLink}
        <p className="mt-3 text-sm text-muted-foreground">
          {data.years.some((y) => y.execution)
            ? t("budget_ministry_intro_with_execution") ||
              "Appropriations from the State Budget Law plus actual execution from the year-end program-budget report (Отчет за изпълнението на програмния бюджет)."
            : t("budget_ministry_intro") ||
              "Appropriations set by the State Budget Law. Ministry-level execution (actual spending) is published in the year-end execution report and is not yet ingested."}
        </p>
        <div className="mt-4">
          <HeroStrip years={data.years} />
        </div>
        <ExpenditureTrendChart years={data.years} />
        <HistoryTable years={data.years} />
        <ProgramBlock years={data.years} lang={lang} />
        <MinistryPersonnelBlock adminId={data.nodeId} />
        {data.procurement ? (
          <ProcurementBlock procurement={data.procurement} years={data.years} />
        ) : null}
      </section>
    </>
  );
};
