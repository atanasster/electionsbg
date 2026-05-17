// Annual general-government fiscal trend from Eurostat (ESA) — 21 years of
// history rather than the КФП feed's 5. Revenue + expenditure as lines, the
// budget balance as bars on a secondary axis. We use Eurostat throughout
// rather than mixing with КФП because the two methodologies have different
// scope (general government vs. consolidated state-only) and basis (accrual
// vs. cash) — mixing them would create artificial jumps that read like real
// fiscal events. Quarterly Eurostat points are aggregated to annual totals;
// in-progress years (fewer than 4 quarters) are dropped.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { useMacro, type MacroPoint } from "@/data/macro/useMacro";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";

const compactEur = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v}`;
};

// Mobile drops the € prefix and decimal to keep Y-axis labels inside the
// chart's narrow left gutter. The currency is already established by the
// chart title — repeating it on every tick wastes pixels.
const compactEurMobile = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(0)}B`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return `${v}`;
};

interface ChartDatum {
  fiscalYear: number;
  revenue: number;
  expenditure: number;
  balance: number;
}

// Eurostat publishes quarterly values in €M. Sum the four quarters to get a
// nominal annual total in EUR. Years missing a quarter (typically the
// current in-progress year before Q4 is published) are dropped — projecting
// from partial quarters would introduce seasonality artifacts that don't
// belong on a 20-year smoothed chart.
const annualize = (points: MacroPoint[] | undefined): Map<number, number> => {
  const out = new Map<number, { sum: number; n: number }>();
  for (const p of points ?? []) {
    const row = out.get(p.year) ?? { sum: 0, n: 0 };
    row.sum += p.value;
    row.n += 1;
    out.set(p.year, row);
  }
  const complete = new Map<number, number>();
  for (const [y, { sum, n }] of out) {
    if (n === 4) complete.set(y, sum * 1_000_000); // €M → EUR
  }
  return complete;
};

export const BudgetMultiYearTrendTile: FC = () => {
  const { t } = useTranslation();
  const { data: macro } = useMacro();
  // 21 data points in ≤ 375px wide is too dense: bars overlap, dots merge,
  // labels collide. On mobile we drop the per-year dots, slim the bars and
  // narrow the y-axis gutters so the lines and bars still tell the trend
  // story without each element fighting for space.
  const isMobile = useMediaQueryMatch("xs");

  const data = useMemo<ChartDatum[]>(() => {
    if (!macro) return [];
    const rev = annualize(macro.series.govRevenue);
    const exp = annualize(macro.series.govExpenditure);
    const bal = annualize(macro.series.budgetBalanceNominal);
    const years = [...rev.keys()]
      .filter((y) => exp.has(y) && bal.has(y))
      .sort((a, b) => a - b);
    return years.map((y) => ({
      fiscalYear: y,
      revenue: rev.get(y)!,
      expenditure: exp.get(y)!,
      balance: bal.get(y)!,
    }));
  }, [macro]);

  if (data.length < 2) return null;

  const firstYear = data[0].fiscalYear;
  const lastYear = data[data.length - 1].fiscalYear;

  return (
    <Card className="my-4" data-og="budget-multi-year-trend">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          {t("budget_multi_year_trend_title") || "Multi-year trend"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {(
            t("budget_multi_year_trend_subtitle") ||
            "Annual general-government revenue, expenditure and balance — Eurostat ESA, {{from}}–{{to}}."
          )
            .replace("{{from}}", String(firstYear))
            .replace("{{to}}", String(lastYear))}
        </p>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div style={{ height: 240, width: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                className="stroke-border"
              />
              <XAxis
                dataKey="fiscalYear"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                className="fill-muted-foreground"
              />
              <YAxis
                yAxisId="flow"
                tickFormatter={isMobile ? compactEurMobile : compactEur}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                className="fill-muted-foreground"
                width={isMobile ? 32 : 56}
              />
              {/* Secondary axis for the balance bars. Revenue/expenditure
                  approach €40B+ in recent years while balance stays in the
                  -€5 to +€2B range, so painting both on one axis makes the
                  bars vestigial. The secondary axis lets the deficit visibly
                  grow/shrink across years. Domain forces zero to be the top
                  for deficit years and bottom for surplus years so bars draw
                  from the baseline. */}
              <YAxis
                yAxisId="balance"
                orientation="right"
                tickFormatter={isMobile ? compactEurMobile : compactEur}
                tickLine={false}
                axisLine={false}
                fontSize={11}
                className="fill-muted-foreground"
                width={isMobile ? 32 : 56}
                domain={[
                  (dataMin: number) => Math.min(0, dataMin) * 1.1,
                  (dataMax: number) => Math.max(0, dataMax) * 1.1,
                ]}
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;
                  const d = payload[0].payload as ChartDatum;
                  return (
                    <div className="rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm text-xs space-y-0.5">
                      <div className="font-semibold">{d.fiscalYear}</div>
                      <div className="tabular-nums text-emerald-600">
                        {t("budget_series_revenue") || "Revenue"}:{" "}
                        {formatEur(d.revenue)}
                      </div>
                      <div className="tabular-nums text-rose-600">
                        {t("budget_series_expenditure") || "Expenditure"}:{" "}
                        {formatEur(d.expenditure)}
                      </div>
                      <div className="tabular-nums text-muted-foreground">
                        {t("budget_series_balance") || "Balance"}:{" "}
                        {formatEur(d.balance)}
                      </div>
                    </div>
                  );
                }}
              />
              <ReferenceLine
                yAxisId="balance"
                y={0}
                className="stroke-border"
              />
              <Bar
                yAxisId="balance"
                dataKey="balance"
                radius={[2, 2, 0, 0]}
                barSize={isMobile ? 6 : 14}
              >
                {data.map((d) => (
                  <Cell
                    key={`bal-${d.fiscalYear}`}
                    fill={d.balance < 0 ? "#fb7185" : "#34d399"}
                  />
                ))}
              </Bar>
              <Line
                yAxisId="flow"
                type="monotone"
                dataKey="revenue"
                stroke="#059669"
                strokeWidth={2}
                dot={isMobile ? false : { r: 2.5, fill: "#059669" }}
                activeDot={{ r: 5 }}
              />
              <Line
                yAxisId="flow"
                type="monotone"
                dataKey="expenditure"
                stroke="#e11d48"
                strokeWidth={2}
                dot={isMobile ? false : { r: 2.5, fill: "#e11d48" }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};
