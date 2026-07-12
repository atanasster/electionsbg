// "България спрямо съседите" — defence spending as a share of GDP, Bulgaria
// against its neighbours (Romania, Greece), CEE peers (Hungary, Croatia) and the
// NATO Europe average. A %GDP rate is meaningless without a comparator; this
// answers "is 2% a lot?" — it's roughly the regional norm, well below Greece.
// Bulgaria is drawn bold; the 2% floor is a dashed reference line.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Users2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { PeersFile } from "@/data/defense/useDefenseData";

// Fixed colour per country so lines never repaint. Bulgaria = brand primary
// (drawn thickest); the NATO Europe aggregate = a muted reference grey.
const COLOR: Record<string, string> = {
  BG: "hsl(var(--primary))",
  RO: "hsl(215 45% 45%)",
  GR: "hsl(190 60% 40%)",
  HU: "hsl(35 80% 45%)",
  HR: "hsl(280 40% 55%)",
  NATO_EU: "hsl(var(--muted-foreground))",
};

export const DefensePeerTile: FC<{ data: PeersFile }> = ({ data }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const label = (c: { bg: string; en: string }) => (bg ? c.bg : c.en);

  // Recharts wants row-per-x: [{ year, BG, RO, ... }]. Only set a key when the
  // series carries that index — a country whose series is shorter than `years`
  // then leaves a gap in its line instead of silently reading `undefined`.
  const rows = data.years.map((year, i) => {
    const row: Record<string, number | string> = { year };
    for (const c of data.countries) {
      const v = c.series[i];
      if (v != null) row[c.key] = v;
    }
    return row;
  });

  return (
    <Card id="defense-peers">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Users2 className="h-4 w-4" />
          {bg
            ? "България спрямо съседите (% от БВП)"
            : "Bulgaria vs its peers (% of GDP)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <p className="mb-3 max-w-[64ch] text-xs text-muted-foreground">
          {bg
            ? "2% от БВП е горе-долу регионалната норма — над Хърватия и на нивото на Унгария, но далеч под Гърция. Пунктираната линия е старият праг на НАТО от 2%."
            : "2% of GDP is roughly the regional norm — above Croatia and level with Hungary, but far below Greece. The dashed line is NATO's old 2% floor."}
        </p>
        <div className="h-[300px] w-full">
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
                formatter={(v: number, key: string) => [
                  `${v}%`,
                  label(
                    data.countries.find((c) => c.key === key) ?? {
                      bg: key,
                      en: key,
                    },
                  ),
                ]}
              />
              <Legend
                formatter={(key: string) => (
                  <span style={{ fontSize: 11 }}>
                    {label(
                      data.countries.find((c) => c.key === key) ?? {
                        bg: key,
                        en: key,
                      },
                    )}
                  </span>
                )}
              />
              <ReferenceLine
                y={data.target}
                stroke="hsl(var(--chart-3))"
                strokeDasharray="5 4"
              />
              {data.countries.map((c) => (
                <Line
                  key={c.key}
                  type="monotone"
                  dataKey={c.key}
                  stroke={COLOR[c.key] ?? "hsl(var(--muted-foreground))"}
                  strokeWidth={c.key === "BG" ? 3 : 1.5}
                  strokeDasharray={c.key === "NATO_EU" ? "4 3" : undefined}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
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
