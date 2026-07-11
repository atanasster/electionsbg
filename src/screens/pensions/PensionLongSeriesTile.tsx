// "Заплата, доход и пенсия" — the national wage / insurable-income / pension
// series (chapter 1.3 of the НОИ yearbook), 2020→latest. The gap between the
// average wage and the average pension is the replacement-rate story in one
// picture: pensions track well below both the wage and the insurable income they
// are computed from.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { NoiNationalYear } from "@/data/budget/types";

interface Point {
  year: number;
  wage: number | null;
  income: number | null;
  pension: number | null;
}

export const PensionLongSeriesTile: FC<{ national: NoiNationalYear[] }> = ({
  national,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const points = useMemo<Point[]>(
    () =>
      [...national]
        .sort((a, b) => a.year - b.year)
        .map((n) => ({
          year: n.year,
          wage: n.avgWageEur,
          income: n.avgInsurableIncomeEur,
          pension: n.avgPensionEur,
        })),
    [national],
  );

  // Replacement ratio (pension ÷ wage) at the latest year — the headline.
  const latest = points[points.length - 1];
  const ratio =
    latest?.pension != null && latest.wage
      ? latest.pension / latest.wage
      : null;

  const labels = {
    wage: bg ? "Средна заплата" : "Average wage",
    income: bg ? "Осигурителен доход" : "Insurable income",
    pension: bg ? "Средна пенсия" : "Average pension",
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          {bg
            ? "Заплата, осигурителен доход и пенсия"
            : "Wage, insurable income and pension"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {ratio != null && (
          <div className="text-sm">
            <span className="text-2xl font-bold tabular-nums">
              {(ratio * 100).toLocaleString(lang, { maximumFractionDigits: 0 })}
              %
            </span>{" "}
            <span className="text-muted-foreground">
              {bg
                ? `— средната пенсия спрямо средната заплата (${latest.year})`
                : `— average pension as a share of the average wage (${latest.year})`}
            </span>
          </div>
        )}
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={points}
              margin={{ top: 8, right: 12, bottom: 4, left: 8 }}
            >
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v: number) => `${Math.round(v)}`}
                width={40}
              />
              <Tooltip
                formatter={(v, name) =>
                  typeof v === "number"
                    ? [`€${Math.round(v)}`, name]
                    : [null, name]
                }
                labelFormatter={(y) => String(y)}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 6,
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                isAnimationActive={false}
                dataKey="wage"
                name={labels.wage}
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                isAnimationActive={false}
                dataKey="income"
                name={labels.income}
                stroke="hsl(var(--chart-2, 210 60% 55%))"
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                isAnimationActive={false}
                dataKey="pension"
                name={labels.pension}
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Месечни средни стойности в евро. Източник: НОИ, статистически годишник (гл. 1.3)."
            : "Monthly averages in EUR. Source: НОИ statistical yearbook (ch. 1.3)."}
        </p>
      </CardContent>
    </Card>
  );
};
