// The judiciary view's signature visual: how many cases arrive, how many the
// courts finish, and the backlog that survives each year. Filed vs resolved are
// lines on the left axis; the pending stock at year-end is an area on the right.
//
// The story the chart tells that no ВСС report does: the courts clear almost
// exactly what arrives (clearance hovers around 100%), so the ~130k-case backlog
// is structural — it never drains, whichever way the inflow moves.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { JudiciaryYear } from "@/data/judiciary/useCaseload";

const fmtK = (v: number, lang: string) =>
  `${Math.round(v / 1000).toLocaleString(lang)}k`;

export const CaseloadFlowTile: FC<{ years: JudiciaryYear[] }> = ({ years }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  // ascending by year for the x axis
  const data = [...years]
    .sort((a, b) => a.year - b.year)
    .map((y) => ({
      year: y.year,
      filed: y.total.filed,
      resolved: y.total.resolved,
      pending: y.total.pendingEnd,
    }));
  if (data.length < 2) return null;

  // The caption's "around N" must come from the chart's own data — a literal here
  // would contradict the line above it the first time the backlog moves.
  const backlogK = Math.round(data[data.length - 1].pending / 10000) * 10;
  const backlogLabel = bg
    ? `${backlogK} хиляди`
    : `${(backlogK * 1000).toLocaleString(lang)}`;

  const labels = {
    filed: bg ? "Постъпили дела" : "Cases filed",
    resolved: bg ? "Свършени дела" : "Cases resolved",
    pending: bg ? "Висящи в края на годината" : "Pending at year end",
  };

  return (
    // data-og: OG-card anchor (scripts/og/capture-screens.ts).
    <Card data-og="judiciary-caseload">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" />
          {bg
            ? "Движение на делата в съдилищата"
            : "The movement of cases through the courts"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-border"
                vertical={false}
              />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 12 }}
                className="fill-muted-foreground"
              />
              <YAxis
                yAxisId="flow"
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => fmtK(v as number, lang)}
                className="fill-muted-foreground"
                domain={["dataMin - 60000", "dataMax + 20000"]}
              />
              {/* Recharts only understands +/- in a domain string, so the
                  headroom that keeps the backlog band clear of the flow lines
                  has to come from a function. */}
              <YAxis
                yAxisId="stock"
                orientation="right"
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => fmtK(v as number, lang)}
                className="fill-muted-foreground"
                domain={[0, (dataMax: number) => Math.round(dataMax * 2.6)]}
              />
              <Tooltip
                formatter={(v: number, k: string) => [
                  v.toLocaleString(lang),
                  labels[k as keyof typeof labels] ?? k,
                ]}
                labelFormatter={(l) => String(l)}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  color: "hsl(var(--card-foreground))",
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(k) => labels[k as keyof typeof labels] ?? k}
              />
              <Area
                yAxisId="stock"
                type="monotone"
                dataKey="pending"
                fill="hsl(var(--muted-foreground))"
                stroke="hsl(var(--muted-foreground))"
                fillOpacity={0.15}
                strokeOpacity={0.4}
              />
              <Line
                yAxisId="flow"
                type="monotone"
                dataKey="filed"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
              <Line
                yAxisId="flow"
                type="monotone"
                dataKey="resolved"
                stroke="#10b981"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {bg
            ? `Постъпили и свършени дела (лява ос) и висящите дела в края на всяка година (дясна ос). Съдилищата свършват почти толкова дела, колкото постъпват — затова висящите дела остават около ${backlogLabel} и не намаляват.`
            : `Cases filed and resolved (left axis) against the stock still pending at each year end (right axis). The courts finish almost exactly as many cases as arrive — so the backlog stays near ${backlogLabel} and never drains.`}
        </p>
      </CardContent>
    </Card>
  );
};
