// "Строителство срещу ремонт" — build-vs-repair donut for the АПИ road
// dashboard. Splits the corpus € by work-type group (new build / repair /
// maintenance / design+supervision), the defensible analogue of the mockup's
// "road development vs repairs" panel.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Hammer } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import type {
  WorkGroup,
  WorkGroupAgg,
} from "@/data/procurement/roadAttributes";

const GROUP: Record<WorkGroup, { bg: string; en: string; color: string }> = {
  build: { bg: "Ново строителство", en: "New construction", color: "#1D9E75" },
  rehab: {
    bg: "Ремонт и рехабилитация",
    en: "Repair & rehabilitation",
    color: "#EF9F27",
  },
  maintenance: { bg: "Поддържане", en: "Maintenance", color: "#378ADD" },
  design: {
    bg: "Проектиране и надзор",
    en: "Design & supervision",
    color: "#888780",
  },
  other: { bg: "Друго", en: "Other", color: "#B4B2A9" },
};

export const RoadWorkGroupDonut: FC<{
  groups: WorkGroupAgg[];
  totalEur: number;
}> = ({ groups, totalEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const rows = groups.filter((g) => g.totalEur > 0);
  if (rows.length === 0 || totalEur <= 0) return null;
  const pct = (v: number) =>
    ((v / totalEur) * 100).toLocaleString(lang, { maximumFractionDigits: 0 }) +
    "%";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Hammer className="h-4 w-4" />
          {lang === "bg" ? "Строителство срещу ремонт" : "Build vs repair"}
          <span className="text-xs text-muted-foreground font-normal">
            {lang === "bg" ? "по стойност" : "by value"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center gap-4">
          <div className="h-40 w-40 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="totalEur"
                  nameKey="group"
                  innerRadius={42}
                  outerRadius={72}
                  paddingAngle={1}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {rows.map((g) => (
                    <Cell key={g.group} fill={GROUP[g.group].color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-1.5 text-xs">
            {rows.map((g) => (
              <div key={g.group} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ background: GROUP[g.group].color }}
                />
                <span className="flex-1 truncate">
                  {lang === "bg" ? GROUP[g.group].bg : GROUP[g.group].en}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatEur(g.totalEur)}
                </span>
                <span className="w-9 text-right tabular-nums font-medium">
                  {pct(g.totalEur)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
