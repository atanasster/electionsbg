// "Къде отиват парите — техника срещу заплати" — the equipment/personnel/other
// split of defence spending, 2019–2025, as 100% stacked bars. The story is the
// crossover: the equipment share climbs from 8% (2020) to 32% (2024) as F-16 and
// Stryker deliveries land, while the personnel share falls. NATO's ≥20% equipment
// guideline is noted; Bulgaria cleared it only from 2023.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { CategorySplitFile } from "@/data/defense/useDefenseData";

const COLORS = {
  equipment: "hsl(var(--primary))",
  personnel: "hsl(var(--chart-2))",
  other: "hsl(var(--muted-foreground) / 0.45)",
};

export const DefenseCategorySplitTile: FC<{ data: CategorySplitFile }> = ({
  data,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const label = {
    equipment: bg ? "Техника и НИРД" : "Equipment & R&D",
    personnel: bg ? "Личен състав" : "Personnel",
    other: bg ? "Инфраструктура и издръжка" : "Infrastructure & operations",
  };

  return (
    <Card id="defense-split">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4" />
          {bg
            ? "Къде отиват парите — техника срещу заплати"
            : "Where the money goes — equipment vs personnel"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <p className="mb-3 max-w-[64ch] text-xs text-muted-foreground">
          {bg
            ? `България беше армия с тежък дял за заплати и малко за техника. Доставките на F-16 и Stryker обръщат съотношението — делът за техника скача от 8% (2020) на 32% (2024). Насоката на НАТО е поне ${data.guideline.equipment}% за техника.`
            : `Bulgaria was a personnel-heavy, equipment-starved force. F-16 and Stryker deliveries flip it — the equipment share jumps from 8% (2020) to 32% (2024). NATO's guideline is ≥${data.guideline.equipment}% on equipment.`}
        </p>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.series}
              margin={{ top: 8, right: 12, bottom: 4, left: -8 }}
              barCategoryGap="20%"
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
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
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
                formatter={(v: number, n: string) => [
                  `${v}%`,
                  label[n as keyof typeof label] ?? n,
                ]}
              />
              <Legend
                formatter={(n: string) => (
                  <span style={{ fontSize: 11 }}>
                    {label[n as keyof typeof label] ?? n}
                  </span>
                )}
              />
              <Bar
                dataKey="equipment"
                stackId="a"
                fill={COLORS.equipment}
                isAnimationActive={false}
              />
              <Bar
                dataKey="personnel"
                stackId="a"
                fill={COLORS.personnel}
                isAnimationActive={false}
              />
              <Bar
                dataKey="other"
                stackId="a"
                fill={COLORS.other}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground/80">
          {data.source}
        </p>
      </CardContent>
    </Card>
  );
};
