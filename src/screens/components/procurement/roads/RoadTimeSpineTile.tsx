// "Разходи във времето" — АПИ spend per year, stacked by work category or by
// top corridor. The narrative backbone the snapshot lacked (e.g. the 2024 €2bn
// surge, the 2020 coverage gap). Missing years are filled so gaps read as gaps.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatEurCompact } from "@/lib/currency";
import type { YearAgg, WorkGroup } from "@/lib/roadAttributes";

type Mode = "group" | "corridor" | "region";

const GROUP_KEYS: WorkGroup[] = [
  "build",
  "rehab",
  "maintenance",
  "design",
  "other",
];
const GROUP_META: Record<WorkGroup, { bg: string; en: string; color: string }> =
  {
    build: { bg: "Ново строителство", en: "New build", color: "#1D9E75" },
    rehab: { bg: "Ремонт", en: "Repair", color: "#EF9F27" },
    maintenance: { bg: "Поддържане", en: "Maintenance", color: "#378ADD" },
    design: {
      bg: "Проектиране/надзор",
      en: "Design/oversight",
      color: "#888780",
    },
    other: { bg: "Друго", en: "Other", color: "#B4B2A9" },
  };
const PALETTE = [
  "#1D9E75",
  "#378ADD",
  "#D85A30",
  "#7F77DD",
  "#EF9F27",
  "#D4537E",
];
const OTHER_COLOR = "#B4B2A9";

export const RoadTimeSpineTile: FC<{ years: YearAgg[] }> = ({ years }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const [mode, setMode] = useState<Mode>("group");

  // Keyed-stack keys (corridor / region): union across years, by total €,
  // "other" last. The corridor and region modes share this shape.
  const keyedKeys = (field: "corridors" | "regions") => {
    const tot = new Map<string, number>();
    for (const y of years)
      for (const [k, v] of Object.entries(y[field]))
        tot.set(k, (tot.get(k) ?? 0) + v);
    const keys = [...tot.entries()]
      .filter(([k]) => k !== "other")
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    return [...keys, "other"];
  };
  const corridorKeys = useMemo(() => keyedKeys("corridors"), [years]); // eslint-disable-line react-hooks/exhaustive-deps
  const regionKeys = useMemo(() => keyedKeys("regions"), [years]); // eslint-disable-line react-hooks/exhaustive-deps

  const keyedField = mode === "region" ? "regions" : "corridors";
  const activeKeys = mode === "region" ? regionKeys : corridorKeys;

  // Fill missing years between min and max so a gap shows as an empty column.
  const data = useMemo(() => {
    if (years.length === 0) return [];
    const byYear = new Map(years.map((y) => [y.year, y]));
    const lo = Number(years[0].year);
    const hi = Number(years[years.length - 1].year);
    const out: Record<string, number | string>[] = [];
    for (let yr = lo; yr <= hi; yr++) {
      const y = byYear.get(String(yr));
      const row: Record<string, number | string> = { year: String(yr) };
      if (mode === "group")
        for (const k of GROUP_KEYS) row[k] = y?.groups[k] ?? 0;
      else for (const k of activeKeys) row[k] = y?.[keyedField][k] ?? 0;
      out.push(row);
    }
    return out;
  }, [years, mode, activeKeys, keyedField]);

  if (years.length === 0) return null;
  // The residual means something different per lens: corridor mode lumps the
  // ref-less regional/diverse work, region mode lumps national-corridor work
  // and the smaller oblasti. Label it so the grey block isn't read as "unknown".
  const otherLabel =
    mode === "region"
      ? lang === "bg"
        ? "Извън ОПУ / нац."
        : "Outside ОПУ / national"
      : lang === "bg"
        ? "Без коридор"
        : "No corridor";
  const keyLabel = (k: string) => (k === "other" ? otherLabel : k);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            {lang === "bg" ? "Разходи във времето" : "Spending over time"}
          </CardTitle>
          <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <SelectTrigger className="h-8 w-auto text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="group">
                {lang === "bg" ? "По категория" : "By category"}
              </SelectItem>
              <SelectItem value="corridor">
                {lang === "bg" ? "По коридор" : "By corridor"}
              </SelectItem>
              <SelectItem value="region">
                {lang === "bg" ? "По област (ОПУ)" : "By oblast (ОПУ)"}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
            >
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={-45}
                textAnchor="end"
                height={42}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                width={64}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={(v) => formatEurCompact(Number(v), lang)}
              />
              <Tooltip
                // Default cursor is a full-height grey rect that reads as a
                // giant bar on near-empty years (e.g. 2020) — use a faint one.
                cursor={{
                  fill: "hsl(var(--muted-foreground))",
                  fillOpacity: 0.08,
                }}
                formatter={(v: number, name) => [
                  formatEurCompact(v, lang),
                  name,
                ]}
                contentStyle={{ fontSize: 12 }}
              />
              {mode === "group"
                ? GROUP_KEYS.map((k) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="a"
                      fill={GROUP_META[k].color}
                      name={lang === "bg" ? GROUP_META[k].bg : GROUP_META[k].en}
                      isAnimationActive={false}
                    />
                  ))
                : activeKeys.map((k, i) => (
                    <Bar
                      key={k}
                      dataKey={k}
                      stackId="a"
                      fill={
                        k === "other"
                          ? OTHER_COLOR
                          : PALETTE[i % PALETTE.length]
                      }
                      name={keyLabel(k)}
                      isAnimationActive={false}
                    />
                  ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Legend */}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {(mode === "group"
            ? GROUP_KEYS.map((k) => ({
                key: k,
                label: lang === "bg" ? GROUP_META[k].bg : GROUP_META[k].en,
                color: GROUP_META[k].color,
              }))
            : activeKeys.map((k, i) => ({
                key: k,
                label: keyLabel(k),
                color:
                  k === "other" ? OTHER_COLOR : PALETTE[i % PALETTE.length],
              }))
          ).map((it) => (
            <span key={it.key} className="inline-flex items-center gap-1">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{ background: it.color }}
              />
              {it.label}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/80 pt-1">
          {lang === "bg"
            ? "По година на договора. Празни години (напр. 2018, 2020) отразяват липси в източника, не липса на разход."
            : "By contract year. Empty years (e.g. 2018, 2020) reflect source gaps, not the absence of spending."}
        </p>
      </CardContent>
    </Card>
  );
};
