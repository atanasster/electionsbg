// Portfolio composition over time (audit T3.6): what the declared wealth is MADE OF, year
// by year — property, vehicles, cash, bank deposits, receivables, funds, securities.
//
// The trajectory chart above answers "how much"; this answers "of what", which is often the
// more revealing question: a net worth that holds steady while it shifts out of property and
// into cash is a different story from one that simply grows.
//
// Takes the series as a PROP rather than fetching: it renders directly beneath the
// trajectory, which has already loaded exactly this payload (person_wealth_series carries
// by_category), so a second fetch of the same data would be pure waste.
//
// DEBT IS EXCLUDED. This is a composition of what the person HOLDS; folding a liability
// into a stack of holdings would make the bands sum to something that is not the portfolio.
// The trajectory chart above already plots debt as its own line.

import { FC, Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PieChart } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Card, CardContent } from "@/ux/Card";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { tooltipSurfaceClass } from "@/components/ui/tooltipSurface";
import { cn } from "@/lib/utils";
import type { WealthPoint } from "./usePersonWealth";
import { LegendSwatch } from "./LegendSwatch";
import { COMPOSITION_CATEGORIES } from "./compositionCategories";

const CATEGORIES = COMPOSITION_CATEGORIES;

type Row = { year: number } & Record<string, number>;

export const PersonPortfolioComposition: FC<{ series: WealthPoint[] }> = ({
  series,
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-US";

  const model = useMemo(() => {
    if (series.length < 2) return null;
    const rows: Row[] = series.map((p) => {
      const row: Row = { year: p.year };
      for (const c of CATEGORIES) {
        // Already rounded server-side (090), like every other figure in the payload —
        // written unconditionally so every stacked dataKey is defined on every datum.
        row[c.key] = p.byCategory?.[c.key] ?? 0;
      }
      return row;
    });
    // Only stack categories the person actually declares — an all-zero band is legend
    // noise and an empty colour in the stack.
    const present = CATEGORIES.filter((c) =>
      rows.some((r) => (r[c.key] ?? 0) > 0),
    );
    if (present.length === 0) return null;
    return { rows, present };
  }, [series]);

  if (!model) return null;

  return (
    <Card className="mt-4">
      <CardContent className="pt-6">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <PieChart className="h-4 w-4 text-muted-foreground" />
          {t("pp_composition_title")}
        </div>
        {/* role/aria-label so the chart is not an unlabelled blank to a screen reader —
            the convention the other charts in this codebase follow. */}
        <div
          role="img"
          aria-label={`${t("pp_composition_title")}: ${model.present
            .map((c) => t(`asset_category_${c.key}`))
            .join(", ")}`}
        >
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart
              data={model.rows}
              margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="year"
                type="number"
                domain={["dataMin", "dataMax"]}
                ticks={model.rows.map((r) => r.year)}
                allowDecimals={false}
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                width={52}
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => formatEurCompact(v, locale)}
                stroke="hsl(var(--muted-foreground))"
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const r = payload[0].payload as Row;
                  return (
                    <div className={cn(tooltipSurfaceClass, "p-2 text-xs")}>
                      <div className="font-semibold tabular-nums">{r.year}</div>
                      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 tabular-nums">
                        {model.present
                          .filter((c) => (r[c.key] ?? 0) > 0)
                          .map((c) => (
                            <Fragment key={c.key}>
                              <span style={{ color: c.color }}>
                                {t(`asset_category_${c.key}`)}
                              </span>
                              <span className="text-right">
                                {formatEur(r[c.key], locale)}
                              </span>
                            </Fragment>
                          ))}
                      </div>
                    </div>
                  );
                }}
              />
              {model.present.map((c) => (
                <Area
                  key={c.key}
                  type="monotone"
                  dataKey={c.key}
                  stackId="portfolio"
                  name={t(`asset_category_${c.key}`)}
                  stroke={c.color}
                  fill={c.color}
                  fillOpacity={0.55}
                  strokeWidth={1}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {model.present.map((c) => (
            <LegendSwatch
              key={c.key}
              color={c.color}
              label={t(`asset_category_${c.key}`)}
            />
          ))}
          <span className="ml-auto">{t("pp_composition_note")}</span>
        </div>
      </CardContent>
    </Card>
  );
};
