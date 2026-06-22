// БНБ monthly FDI tile for /indicators/fiscal. Headline cards reproduce the
// year-to-date cumulative FDI and reinvested-earnings figures the press cites
// (e.g. "евро привлякло 7 пъти повече инвестиции"), backed by the monthly
// component series the БНБ balance-of-payments release publishes.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  ComposedChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  FdiComponentKey,
  MacroFdiPayload,
  useMacroFdi,
} from "@/data/macro/useMacroFdi";
import { tooltipSurfaceClass } from "@/components/ui/tooltipSurface";
import { cn } from "@/lib/utils";

// Months of monthly history shown in the chart. The YTD cards summarise the
// whole year; the bars give recent texture without 196 cramped columns.
const CHART_MONTHS = 36;

// Stacked components (sum to the total line). Reinvested earnings is the
// headline driver of the 2026 surge, so it reads naturally in the middle.
const STACK: FdiComponentKey[] = ["equity", "reinvested", "debt"];
// Breakdown-table row order: the net total first, then its three components.
const TABLE_ROWS: FdiComponentKey[] = ["total", "equity", "reinvested", "debt"];
const COMPONENT_COLORS: Record<FdiComponentKey, string> = {
  total: "#111827",
  equity: "#3b82f6",
  reinvested: "#10b981",
  debt: "#f59e0b",
};

type ChartRow = { period: string } & Partial<Record<FdiComponentKey, number>>;

const buildRows = (payload: MacroFdiPayload): ChartRow[] => {
  const byPeriod = new Map<string, ChartRow>();
  (["total", ...STACK] as FdiComponentKey[]).forEach((k) => {
    for (const p of payload.series[k] ?? []) {
      const row = byPeriod.get(p.period) ?? { period: p.period };
      row[k] = p.value;
      byPeriod.set(p.period, row);
    }
  });
  return [...byPeriod.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-CHART_MONTHS);
};

const TooltipContent: FC<{
  active?: boolean;
  payload?: { value: number; dataKey: string; color: string }[];
  label?: string;
  labels: MacroFdiPayload["labels"];
  lang: "en" | "bg";
  fmt: (v: number) => string;
}> = ({ active, payload, label, labels, lang, fmt }) => {
  if (!active || !label) return null;
  return (
    <div className={cn(tooltipSurfaceClass, "px-3 py-2 text-xs")}>
      <div className="font-semibold mb-1">{label}</div>
      <div className="flex flex-col gap-0.5">
        {payload?.map((p) => {
          const key = p.dataKey as FdiComponentKey;
          return (
            <div key={key} className="flex justify-between gap-3">
              <span style={{ color: p.color }}>
                {lang === "bg" ? labels[key].bg : labels[key].en}
              </span>
              <span className="font-semibold tabular-nums">
                {typeof p.value === "number" ? fmt(p.value) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const FdiMonthlyTile: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";
  const { data: fdi } = useMacroFdi();

  const rows = useMemo(() => (fdi ? buildRows(fdi) : []), [fdi]);

  if (!fdi || rows.length === 0) return null;

  const { ytd, labels } = fdi;
  const locale = lang === "bg" ? "bg-BG" : "en-US";

  // EUR-million inputs. Render large flows as billions, smaller as millions,
  // following the € prefix used by the sibling fiscal charts.
  const fmtAmount = (vM: number): string => {
    const sign = vM < 0 ? "-" : "";
    const abs = Math.abs(vM);
    if (abs >= 1000) {
      return `${sign}€${(abs / 1000).toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}${lang === "bg" ? " млрд." : "B"}`;
    }
    return `${sign}€${abs.toLocaleString(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}${lang === "bg" ? " млн." : "M"}`;
  };
  // Axis ticks stay in the source unit (EUR million); the tooltip + cards
  // carry the friendlier billions/millions formatting.
  const fmtAxis = (vM: number): string => `€${Math.round(vM)}`;

  // Signed EUR-million for the breakdown table (one consistent unit per column
  // so the rows line up); + sign on the change column to read as a delta.
  const fmtMln = (vM: number, signed = false): string => {
    const sign = vM < 0 ? "-" : signed && vM > 0 ? "+" : "";
    const s = Math.abs(vM).toLocaleString(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return `${sign}€${s}`;
  };
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
  }).format(new Date(ytd.current.year, ytd.month - 1, 1));

  const caption = `${lang === "bg" ? ytd.rangeBg : ytd.rangeEn} ${
    ytd.current.year
  }`;
  const factorText =
    ytd.totalRatio != null
      ? t("fdi_monthly_factor", {
          factor: ytd.totalRatio.toLocaleString(locale, {
            maximumFractionDigits: 1,
          }),
          year: ytd.prior.year,
        })
      : null;
  const growthText =
    ytd.reinvestedGrowthPct != null
      ? t("fdi_monthly_growth", {
          pct: `${ytd.reinvestedGrowthPct > 0 ? "+" : ""}${ytd.reinvestedGrowthPct.toLocaleString(
            locale,
            { maximumFractionDigits: 0 },
          )}`,
          year: ytd.prior.year,
        })
      : null;

  return (
    <div className="w-full">
      {/* YTD headline cards — the figures the press release leads with. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div className="rounded-lg border border-border p-4">
          <div className="text-xs text-muted-foreground mb-1">
            {lang === "bg" ? labels.total.bg : labels.total.en}
            {" · "}
            {caption}
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            {fmtAmount(ytd.current.total)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {factorText && (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {factorText}
              </span>
            )}
            {factorText && " · "}
            {t("fdi_monthly_prior", {
              amount: fmtAmount(ytd.prior.total),
              year: ytd.prior.year,
            })}
          </div>
        </div>
        <div className="rounded-lg border border-border p-4">
          <div className="text-xs text-muted-foreground mb-1">
            {lang === "bg" ? labels.reinvested.bg : labels.reinvested.en}
            {" · "}
            {caption}
          </div>
          <div className="text-2xl font-semibold tabular-nums">
            {fmtAmount(ytd.current.reinvested)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {growthText && (
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {growthText}
              </span>
            )}
            {growthText && " · "}
            {t("fdi_monthly_prior", {
              amount: fmtAmount(ytd.prior.reinvested),
              year: ytd.prior.year,
            })}
          </div>
        </div>
      </div>

      {/* Full component breakdown — every figure the press-release table carries:
          the latest month, the year-to-date total this year and last, and the
          year-on-year change, for each of the four FDI components. */}
      <div className="overflow-x-auto mb-5">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="text-left font-medium py-1.5 pr-2">
                {t("fdi_monthly_th_component")}
              </th>
              <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap">
                {monthLabel}
              </th>
              <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap">
                {caption}
              </th>
              <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap">
                {`${lang === "bg" ? ytd.rangeBg : ytd.rangeEn} ${ytd.prior.year}`}
              </th>
              <th className="text-right font-medium py-1.5 pl-2">
                {t("fdi_monthly_th_change")}
              </th>
            </tr>
          </thead>
          <tbody>
            {TABLE_ROWS.map((k) => {
              const delta = ytd.current[k] - ytd.prior[k];
              return (
                <tr key={k} className="border-b border-border/50">
                  <td className="text-left py-1.5 pr-2">
                    <span className="inline-flex items-center gap-1.5">
                      {k !== "total" && (
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-sm"
                          style={{ backgroundColor: COMPONENT_COLORS[k] }}
                        />
                      )}
                      <span className={k === "total" ? "font-semibold" : ""}>
                        {lang === "bg" ? labels[k].bg : labels[k].en}
                      </span>
                    </span>
                  </td>
                  <td className="text-right py-1.5 px-2 tabular-nums whitespace-nowrap">
                    {fmtMln(fdi.latest[k])}
                  </td>
                  <td
                    className={`text-right py-1.5 px-2 tabular-nums whitespace-nowrap ${
                      k === "total" ? "font-semibold" : ""
                    }`}
                  >
                    {fmtMln(ytd.current[k])}
                  </td>
                  <td className="text-right py-1.5 px-2 tabular-nums whitespace-nowrap text-muted-foreground">
                    {fmtMln(ytd.prior[k])}
                  </td>
                  <td
                    className={`text-right py-1.5 pl-2 tabular-nums whitespace-nowrap ${
                      delta >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {fmtMln(delta, true)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Component legend + axis unit hint (the chart is in EUR million/month,
          which the bare "€500" axis ticks would otherwise leave ambiguous). */}
      <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
        {STACK.map((k) => (
          <span
            key={k}
            className="px-2.5 py-0.5 rounded-full border-transparent text-white"
            style={{ backgroundColor: COMPONENT_COLORS[k] }}
          >
            {lang === "bg" ? labels[k].bg : labels[k].en}
          </span>
        ))}
        <span className="px-2.5 py-0.5 rounded-full border border-border">
          {lang === "bg" ? labels.total.bg : labels.total.en}
        </span>
        <span className="ml-auto text-muted-foreground">
          {lang === "bg" ? "млн. € / месец" : "EUR million / month"}
        </span>
      </div>

      <div className="w-full" style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={rows}
            stackOffset="sign"
            margin={{ top: 8, right: 8, left: 4, bottom: 4 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              opacity={0.2}
            />
            <XAxis
              dataKey="period"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval={5}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={44}
              tickFormatter={fmtAxis}
            />
            <Tooltip
              content={
                <TooltipContent labels={labels} lang={lang} fmt={fmtAmount} />
              }
            />
            <ReferenceLine y={0} stroke="#64748b" strokeOpacity={0.4} />
            {STACK.map((k) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="fdi"
                fill={COMPONENT_COLORS[k]}
                isAnimationActive={false}
              />
            ))}
            <Line
              type="monotone"
              dataKey="total"
              stroke={COMPONENT_COLORS.total}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="text-[11px] text-muted-foreground mt-2">
        {t("fdi_monthly_latest", { period: fdi.latestPeriod })}
      </div>
    </div>
  );
};
