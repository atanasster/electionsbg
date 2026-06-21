// By-year breakdown rendered as a Recharts bar chart. Replaces the inline
// year/total/count table on the company page so the operator can eyeball
// the trend instead of reading 12 rows. Hover surfaces the exact figures.
//
// Bars encode the euro total; the contract count lives in the hover tooltip
// (a second-axis line drew a count dot floating against the bars on an
// unrelated scale — same x, different y meaning — which read as noise). A
// single year is not a trend, so it renders as a one-line stat strip instead.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { TrendingUp } from "lucide-react";
import type { ProcurementByYear } from "@/data/dataTypes";
import { formatEur } from "@/lib/currency";

// Per-year rollup row. The euro total (`totalEur`) is what this chart plots;
// `totalOther` (rare USD/GBP/CHF remainder) is not charted.
export type ByYearRow = ProcurementByYear;

interface ChartDatum {
  year: string;
  eur: number;
  contractCount: number;
}

interface TooltipPayload {
  payload: ChartDatum;
}

// `N договор/договора` — the count form (бройна форма) after a numeral, not the
// bare plural `договори`. The number keeps its locale grouping; the noun comes
// from the i18next plural key.
const ContractCount: FC<{ count: number }> = ({ count }) => {
  const { t } = useTranslation();
  return (
    <>
      {count.toLocaleString("bg-BG")}{" "}
      {t("company_contracts_noun", { count }) || "contracts"}
    </>
  );
};

const ChartTooltip: FC<{ active?: boolean; payload?: TooltipPayload[] }> = ({
  active,
  payload,
}) => {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm text-xs">
      <div className="font-semibold">{d.year}</div>
      <div className="tabular-nums">{formatEur(d.eur)}</div>
      <div className="text-muted-foreground tabular-nums">
        <ContractCount count={d.contractCount} />
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
    eur: r.totalEur,
    contractCount: r.contractCount,
  }));

  const heading = (
    <CardHeader className="pb-2">
      <CardTitle className="text-base flex items-center gap-2">
        <TrendingUp className="h-4 w-4" />
        {title ?? t("company_by_year") ?? "By year"}
      </CardTitle>
    </CardHeader>
  );

  // A single year is not a trend — one bar reads as a floating, contextless
  // block. Show the figures as a compact strip instead.
  if (data.length === 1) {
    const d = data[0];
    return (
      <Card className="my-4">
        {heading}
        <CardContent className="p-3 md:p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-sm font-semibold tabular-nums">{d.year}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-base font-bold tabular-nums">
              {formatEur(d.eur)}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground tabular-nums">
              <ContractCount count={d.contractCount} />
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="my-4">
      {heading}
      <CardContent className="p-3 md:p-4">
        <div style={{ height: 260, width: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
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
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              />
              <Bar dataKey="eur" fill="#d97706" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};
