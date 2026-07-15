// Разход на свършено дело — the money-per-output ratio the ВСС reports never join.
//
// The honest version of this metric is SCOPE-MATCHED: the "Съдилища на РБ" budget
// line from the ЗДБРБ (the courts' own appropriation) divided by the courts' own
// resolved cases (Приложение № 1). Both sides exclude the prosecution, ВКС and ВАС —
// so we never fold €250M of prosecution money into a per-court-case cost, which a
// "total judiciary budget ÷ court cases" figure silently does.
//
// The finding: this ratio has climbed ~2.6× in eight years while resolved volume is
// flat — courts do the same work for steadily more money.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Coins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur, formatCount } from "@/lib/currency";
import type { JudiciaryYear } from "@/data/judiciary/useCaseload";
import type { JudiciaryBudgetFile } from "@/data/budget/types";
import { costPerResolvedCase } from "@/data/judiciary/costPerCase";

export const CostPerCaseTile: FC<{
  years: JudiciaryYear[];
  budget: JudiciaryBudgetFile;
}> = ({ years, budget }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const data = useMemo(
    () => costPerResolvedCase(years, budget),
    [years, budget],
  );
  if (data.length < 2) return null;

  const latest = data[data.length - 1];
  const first = data[0];
  const multiple = latest.eurPerCase / first.eurPerCase;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Coins className="h-4 w-4" />
          {bg ? "Разход на свършено дело" : "Cost per resolved case"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          {/* Headline number */}
          <div className="md:w-48 md:shrink-0">
            <div className="text-3xl font-bold tabular-nums">
              {formatEur(Math.round(latest.eurPerCase), lang)}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {bg ? `на дело · ${latest.year} г.` : `per case · ${latest.year}`}
            </div>
            <div className="mt-2 inline-block rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              {bg
                ? `×${formatCount(multiple, lang, 1)} спрямо ${first.year} г.`
                : `×${formatCount(multiple, lang, 1)} vs ${first.year}`}
            </div>
          </div>

          {/* Trend */}
          <div className="h-[180px] min-w-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
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
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => formatEur(v as number, lang)}
                  className="fill-muted-foreground"
                  width={48}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                  formatter={(v: number) => [
                    formatEur(Math.round(v), lang),
                    bg ? "Разход на дело" : "Cost per case",
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
                <Bar dataKey="eurPerCase" radius={[3, 3, 0, 0]}>
                  {data.map((d) => (
                    <Cell
                      key={d.year}
                      fill={
                        d.year === latest.year
                          ? "hsl(var(--primary))"
                          : "hsl(var(--primary) / 0.35)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {bg
            ? "Бюджетът на съдилищата (перо „Съдилища на Република България“ от ЗДБРБ) ÷ свършените от тях дела за годината. Двете страни са с еднакъв обхват — прокуратурата, ВКС и ВАС имат отделни бюджети и се броят отделно, затова не влизат в сметката."
            : "The courts' appropriation (the ЗДБРБ line “Courts of the Republic of Bulgaria”) ÷ the cases they resolved that year. Both sides share one scope — the prosecution, the Supreme Court of Cassation and the Supreme Administrative Court have their own budgets and are counted separately, so they are excluded from the ratio."}
        </p>
      </CardContent>
    </Card>
  );
};
