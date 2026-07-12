// "Пътят към 5%" — the signature tile. Bulgaria's defence spending as a share of
// GDP, 2014–2025, against the moving NATO targets: the old 2% floor (Wales 2014,
// now cleared) and the Hague-2025 commitment of 5% by 2035 (3.5% core + 1.5%
// related). The 2019 spike is annotated as the one-off F-16 down-payment. This is
// the "how much" story every reader is arguing about right now.
//
// id="defense-gdp" is the OG-card crop anchor for the /defense screen; the inner
// data-og="defense-gdp-chart" is the render-wait target (Recharts surface).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { GdpShareFile } from "@/data/defense/useDefenseData";

export const DefenseGdpTile: FC<{ data: GdpShareFile }> = ({ data }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const rows = data.series;
  const { wales2, hagueCore, hagueTotal, hagueYear } = data.targets;

  return (
    <Card id="defense-gdp">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          {bg ? "Пътят към 5%" : "The road to 5%"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <p className="mb-3 max-w-[64ch] text-xs text-muted-foreground">
          {bg
            ? "Разходите за отбрана като дял от БВП. Целите на НАТО се менят: старият праг от 2% вече е прекрачен; Хага 2025 въведе 5% до 2035 г. Скокът през 2019 г. е еднократно авансово плащане по F-16."
            : "Defence spending as a share of GDP. NATO's targets are moving: the old 2% floor is now cleared; Hague 2025 set 5% by 2035. The 2019 spike is a one-off F-16 down-payment."}
        </p>
        <div data-og="defense-gdp-chart" className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={rows}
              margin={{ top: 8, right: 12, bottom: 4, left: -8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
              />
              <YAxis
                domain={[0, 5.5]}
                ticks={[0, 1, 2, 3, 4, 5]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={38}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
                formatter={(v: number, _n, p) => [
                  `${v}%${p.payload.estimate ? (bg ? " (оценка)" : " (est.)") : ""}`,
                  bg ? "Дял от БВП" : "Share of GDP",
                ]}
              />
              <ReferenceLine
                y={wales2}
                stroke="hsl(var(--chart-3))"
                strokeDasharray="5 4"
                label={{
                  value: bg
                    ? `Цел ${wales2}% (Уелс 2014)`
                    : `${wales2}% (Wales 2014)`,
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "hsl(var(--chart-3))",
                }}
              />
              <ReferenceLine
                y={hagueCore}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 4"
                label={{
                  value: bg
                    ? `${hagueCore}% основна отбрана`
                    : `${hagueCore}% core`,
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "hsl(var(--muted-foreground))",
                }}
              />
              <ReferenceLine
                y={hagueTotal}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="5 4"
                label={{
                  value: bg
                    ? `Цел ${hagueTotal}% до ${hagueYear} (Хага)`
                    : `${hagueTotal}% by ${hagueYear} (Hague)`,
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "hsl(var(--muted-foreground))",
                }}
              />
              <Line
                type="monotone"
                dataKey="pct"
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                dot={{ r: 2.5, fill: "hsl(var(--primary))" }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {data.source}
        </p>
      </CardContent>
    </Card>
  );
};
