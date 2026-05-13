// By-year breakdown rendered as a Recharts bar chart. Replaces the inline
// year/total/count table on the company page so the operator can eyeball
// the trend instead of reading 12 rows. Hover surfaces the exact figures.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { TrendingUp } from "lucide-react";

const FMT_INT = new Intl.NumberFormat("bg-BG", { maximumFractionDigits: 0 });

// EUR conversion rates — must match formatAmount.ts on the SPA + by_ns.ts
// on the pipeline. Duplicated here to keep this chart component self-
// contained.
const EUR_PER_UNIT: Record<string, number> = {
  EUR: 1,
  BGN: 1 / 1.95583,
  USD: 0.92,
  GBP: 1.17,
  CHF: 1.05,
};

const toEur = (bag: Record<string, number>): number => {
  let eur = 0;
  for (const [cur, amt] of Object.entries(bag)) {
    if (!amt || amt <= 0) continue;
    const rate = EUR_PER_UNIT[cur];
    if (rate === undefined) continue;
    eur += amt * rate;
  }
  return eur;
};

export interface ByYearRow {
  year: string;
  totalByCurrency: Record<string, number>;
  contractCount: number;
}

interface ChartDatum {
  year: string;
  eur: number;
  contractCount: number;
}

interface TooltipPayload {
  payload: ChartDatum;
}

const ChartTooltip: FC<{ active?: boolean; payload?: TooltipPayload[] }> = ({
  active,
  payload,
}) => {
  const { t } = useTranslation();
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm text-xs">
      <div className="font-semibold">{d.year}</div>
      <div className="tabular-nums">€{FMT_INT.format(Math.round(d.eur))}</div>
      <div className="text-muted-foreground tabular-nums">
        {d.contractCount.toLocaleString("bg-BG")}{" "}
        {t("company_col_contracts") || "contracts"}
      </div>
    </div>
  );
};

export const CompanyByYearChart: FC<{
  rows: ByYearRow[];
  // Optional title override — the company page calls it "По години", the
  // awarder page could call it the same.
  title?: string;
}> = ({ rows, title }) => {
  const { t } = useTranslation();
  if (!rows || rows.length === 0) return null;
  // Sort ascending by year so the chart reads left-to-right chronologically.
  const sorted = [...rows].sort((a, b) => a.year.localeCompare(b.year));
  const data: ChartDatum[] = sorted.map((r) => ({
    year: r.year,
    eur: toEur(r.totalByCurrency),
    contractCount: r.contractCount,
  }));

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          {title ?? t("company_by_year") ?? "By year"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div style={{ height: 260, width: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            {/* ComposedChart: bars on the left axis show EUR amounts, line
                on the right axis shows the contract count. The two axes let
                the operator read volume (count) against value (EUR) at a
                glance — same data, two angles. */}
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
                dataKey="year"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                className="fill-muted-foreground"
              />
              <YAxis
                yAxisId="eur"
                tickFormatter={(v: number) =>
                  v >= 1_000_000_000
                    ? `€${(v / 1_000_000_000).toFixed(1)}B`
                    : v >= 1_000_000
                      ? `€${(v / 1_000_000).toFixed(0)}M`
                      : v >= 1_000
                        ? `€${(v / 1_000).toFixed(0)}k`
                        : `€${v}`
                }
                tickLine={false}
                axisLine={false}
                fontSize={11}
                className="fill-muted-foreground"
                width={56}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                className="fill-muted-foreground"
                width={36}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              />
              <Bar
                yAxisId="eur"
                dataKey="eur"
                fill="#d97706"
                radius={[2, 2, 0, 0]}
              />
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="contractCount"
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 3, fill: "#2563eb" }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};
