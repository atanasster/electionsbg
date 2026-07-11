// "До 2070 г." — the pension system's long-run projection, made interactive. НОИ
// publishes a full actuarial projection to 2070 and it dies in a PDF; the EU
// Ageing Report projects the same thing independently. We plot both as named
// lines (NOT a fabricated probability fan — a 45-year projection's uncertainty is
// structural, and the honest device is a second independent opinion). The two
// disagree by ~1pp of GDP, which is itself the point: even the experts' central
// estimates differ.
//
// Anchors are the verified figures from §3.3 of the plan (НОИ Актюерски доклад
// 2024 + EC 2024 Ageing Report, BG fiche); annual points are linearly
// interpolated between them.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LineChartIcon } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";

// [year, % of GDP] anchors — pension expenditure. Interpolated between.
const NOI_ANCHORS: [number, number][] = [
  [2023, 10.4],
  [2027, 11.5],
  [2040, 10.0],
  [2070, 10.5],
];
const EC_ANCHORS: [number, number][] = [
  [2022, 9.5],
  [2025, 10.8],
  [2070, 9.6],
];

const interpolate = (anchors: [number, number][], year: number): number => {
  if (year <= anchors[0][0]) return anchors[0][1];
  if (year >= anchors[anchors.length - 1][0])
    return anchors[anchors.length - 1][1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [y0, v0] = anchors[i];
    const [y1, v1] = anchors[i + 1];
    if (year >= y0 && year <= y1)
      return v0 + ((v1 - v0) * (year - y0)) / (y1 - y0);
  }
  return anchors[anchors.length - 1][1];
};

interface Point {
  year: number;
  noi: number;
  ec: number;
}

export const PensionProjectionTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const points = useMemo<Point[]>(() => {
    const out: Point[] = [];
    for (let y = 2023; y <= 2070; y += 1)
      out.push({
        year: y,
        noi: Number(interpolate(NOI_ANCHORS, y).toFixed(2)),
        ec: Number(interpolate(EC_ANCHORS, y).toFixed(2)),
      });
    return out;
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <LineChartIcon className="h-4 w-4" />
          {bg
            ? "Разходи за пенсии до 2070 г. (% от БВП)"
            : "Pension spending to 2070 (% of GDP)"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          {bg
            ? "Две независими прогнози — на НОИ и на ЕК — за едно и също нещо. Разминаването от ~1 пр.п. от БВП е самото послание: дори експертните оценки се различават."
            : "Two independent projections — НОИ's and the EU's — of the same thing. The ~1pp-of-GDP gap is the message: even the experts' central estimates differ."}
        </p>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 8, right: 12, bottom: 4, left: 8 }}
            >
              <XAxis
                dataKey="year"
                type="number"
                domain={[2023, 2070]}
                ticks={[2023, 2030, 2040, 2050, 2060, 2070]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                domain={[8, 12]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v: number) => `${v}%`}
                width={34}
              />
              <Tooltip
                formatter={(v: number, name: string) => [
                  `${v}% ${bg ? "от БВП" : "of GDP"}`,
                  name,
                ]}
                labelFormatter={(y) => String(y)}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 6,
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine
                x={2027}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="3 3"
                label={{
                  value: bg ? "пик" : "peak",
                  position: "top",
                  fontSize: 9,
                  fill: "hsl(var(--muted-foreground))",
                }}
              />
              <Line
                type="monotone"
                isAnimationActive={false}
                dataKey="noi"
                name={bg ? "НОИ (актюерски доклад)" : "НОИ (actuarial report)"}
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                isAnimationActive={false}
                dataKey="ec"
                name={
                  bg ? "ЕК (доклад за застаряването)" : "EC (Ageing Report)"
                }
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Успоредно: коефициентът на заместване пада от 55% (2023) към ~44% (2070), а съотношението пенсионери/осигурени расте от 68% към 81% (2060). Дефицитът на ДОО остава ~5% от БВП. Източници: НОИ, Актюерски доклад 2024; ЕК, Доклад за застаряването 2024 (досие България)."
            : "Alongside: the replacement rate falls from 55% (2023) toward ~44% (2070), and the pensioners-to-insured ratio rises from 68% to 81% (2060). The ДОО deficit stays ~5% of GDP. Sources: НОИ Actuarial Report 2024; EC 2024 Ageing Report (Bulgaria fiche)."}
        </p>
      </CardContent>
    </Card>
  );
};
