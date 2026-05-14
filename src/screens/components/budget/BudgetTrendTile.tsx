// Monthly КФП execution trend. Revenue + expenditure as lines, balance as
// bars, one point per published monthly snapshot. The egov feed publishes
// cumulative year-to-date execution, so the series ramps up within each
// fiscal year and resets each January — the caption says so.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LineChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import type { KfpObservation } from "@/data/budget/types";

const compactEur = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return `€${v}`;
};

interface ChartDatum {
  period: string;
  revenue: number;
  expenditure: number;
  balance: number;
}

const buildData = (observations: KfpObservation[]): ChartDatum[] => {
  const byPeriod = new Map<string, ChartDatum>();
  for (const o of observations) {
    let d = byPeriod.get(o.period);
    if (!d) {
      d = { period: o.period, revenue: 0, expenditure: 0, balance: 0 };
      byPeriod.set(o.period, d);
    }
    if (o.series === "revenue") d.revenue = o.executed.amountEur;
    if (o.series === "expenditure") d.expenditure = o.executed.amountEur;
    if (o.series === "balance") d.balance = o.executed.amountEur;
  }
  return [...byPeriod.values()].sort((a, b) =>
    a.period.localeCompare(b.period),
  );
};

const ChartTooltip: FC<{
  active?: boolean;
  payload?: Array<{ payload: ChartDatum }>;
}> = ({ active, payload }) => {
  const { t } = useTranslation();
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm text-xs space-y-0.5">
      <div className="font-semibold">{d.period}</div>
      <div className="tabular-nums text-emerald-600">
        {t("budget_series_revenue") || "Revenue"}: {formatEur(d.revenue)}
      </div>
      <div className="tabular-nums text-rose-600">
        {t("budget_series_expenditure") || "Expenditure"}:{" "}
        {formatEur(d.expenditure)}
      </div>
      <div className="tabular-nums text-muted-foreground">
        {t("budget_series_balance") || "Balance"}: {formatEur(d.balance)}
      </div>
    </div>
  );
};

export const BudgetTrendTile: FC<{ observations: KfpObservation[] }> = ({
  observations,
}) => {
  const { t } = useTranslation();
  const data = buildData(observations);
  if (data.length === 0) return null;

  return (
    <Card className="my-4" data-og="budget-trend">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <LineChart className="h-4 w-4" />
          {t("budget_trend_title") || "Execution trend"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div style={{ height: 280, width: "100%" }}>
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
                dataKey="period"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                className="fill-muted-foreground"
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
                content={<ChartTooltip />}
                cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              />
              <ReferenceLine y={0} className="stroke-border" />
              <Bar dataKey="balance" fill="#94a3b8" radius={[2, 2, 0, 0]} />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#059669"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "#059669" }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="expenditure"
                stroke="#e11d48"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "#e11d48" }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground/80 mt-2">
          {t("budget_trend_caption") ||
            "Cumulative execution within each fiscal year — figures reset each January. Pre-2026 leva converted to euro at the locked 1.95583 parity."}
        </p>
      </CardContent>
    </Card>
  );
};
