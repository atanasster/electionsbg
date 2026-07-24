// The declared-wealth trajectory (audit T3.1, the requested feature): assets, debts and
// net worth by year from the Court-of-Audit (Сметна палата) property declarations
// (person_wealth_series, 090), with a marker on every Entry / Vacate filing so "worth
// entering vs leaving office" reads off the chart.
//
// FRAMING (defamation-safe, per docs/methodology/accumulation-gap.md): every figure is
// DECLARED, not audited, and real estate with no declared price counts as €0 — the hint
// says so. No number is computed here: the payload is already rounded server-side, and the
// chart only plots it.
//
// Self-gates at ≥2 asset-bearing years — a single point is not a trajectory, and the
// per-year assets already render in the declaration block, so a one-filing person shows
// nothing here.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceDot,
} from "recharts";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { Card, CardContent } from "@/ux/Card";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { tooltipSurfaceClass } from "@/components/ui/tooltipSurface";
import { cn } from "@/lib/utils";
import { usePersonWealth, type WealthPoint } from "./usePersonWealth";
import { PersonPortfolioComposition } from "./PersonPortfolioComposition";
import { LegendSwatch } from "./LegendSwatch";

const COLORS = {
  assets: "hsl(160 60% 42%)", // green — what they hold
  debts: "hsl(0 65% 55%)", // red — what they owe
  net: "hsl(217 70% 45%)", // blue — the bottom line
};

type Row = WealthPoint & { markerType?: "Entry" | "Vacate" };

export const PersonWealthTrajectory: FC<{ slug: string }> = ({ slug }) => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const locale = bg ? "bg-BG" : "en-US";
  const wealth = usePersonWealth(slug);

  const model = useMemo(() => {
    if (!wealth || wealth.series.length < 2) return null;
    // A year is worth an Entry/Vacate marker if a filing of that type falls in it; the net
    // at that year is the series value (the representative filing), which is what the marker
    // dot sits on.
    const markerByYear = new Map<number, "Entry" | "Vacate">();
    for (const m of wealth.markers) {
      // Vacate wins if both fell in one year — it is the later snapshot.
      if (m.type === "Vacate") markerByYear.set(m.year, "Vacate");
      else if (!markerByYear.has(m.year)) markerByYear.set(m.year, "Entry");
    }
    const rows: Row[] = wealth.series.map((p) => ({
      ...p,
      markerType: markerByYear.get(p.year),
    }));
    return { rows, series: wealth.series };
  }, [wealth]);

  if (!model) return null;

  const fmtAxis = (v: number) => formatEurCompact(v, locale);
  const label = (k: "assets" | "debts" | "net"): string => t(`pp_wealth_${k}`);

  return (
    <DashboardSection
      id="person-wealth"
      title={t("pp_wealth_title")}
      icon={TrendingUp}
      subtitle={t("pp_wealth_hint")}
    >
      <Card>
        <CardContent className="pt-6">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart
              data={model.rows}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              {/* Numeric axis so a gap year (a year the person did not file) leaves a
                  proportional gap rather than collapsing the points to even slots. */}
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
                tickFormatter={fmtAxis}
                stroke="hsl(var(--muted-foreground))"
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const r = payload[0].payload as Row;
                  return (
                    <div className={cn(tooltipSurfaceClass, "p-2 text-xs")}>
                      <div className="font-semibold tabular-nums">{r.year}</div>
                      {r.markerType && (
                        <div className="text-muted-foreground">
                          {t(`pp_wealth_marker_${r.markerType.toLowerCase()}`)}
                        </div>
                      )}
                      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 tabular-nums">
                        <span style={{ color: COLORS.net }}>
                          {label("net")}
                        </span>
                        <span className="text-right">
                          {formatEur(r.netEur, locale)}
                        </span>
                        <span style={{ color: COLORS.assets }}>
                          {label("assets")}
                        </span>
                        <span className="text-right">
                          {formatEur(r.assetsEur, locale)}
                        </span>
                        <span style={{ color: COLORS.debts }}>
                          {label("debts")}
                        </span>
                        <span className="text-right">
                          {formatEur(r.debtsEur, locale)}
                        </span>
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="assetsEur"
                name={label("assets")}
                stroke={COLORS.assets}
                fill={COLORS.assets}
                fillOpacity={0.12}
                strokeWidth={1.5}
              />
              <Line
                type="monotone"
                dataKey="debtsEur"
                name={label("debts")}
                stroke={COLORS.debts}
                strokeWidth={1.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="netEur"
                name={label("net")}
                stroke={COLORS.net}
                strokeWidth={2.6}
                dot={false}
              />
              {/* Entry/Vacate markers sit on the net line. */}
              {model.rows
                .filter((r) => r.markerType)
                .map((r) => (
                  <ReferenceDot
                    key={`${r.year}-${r.markerType}`}
                    x={r.year}
                    y={r.netEur}
                    r={4}
                    fill={
                      r.markerType === "Vacate" ? COLORS.debts : COLORS.assets
                    }
                    stroke="hsl(var(--background))"
                    strokeWidth={1.5}
                  />
                ))}
            </ComposedChart>
          </ResponsiveContainer>
          {/* Legend + the mandatory "declared, not audited" caveat. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <LegendSwatch color={COLORS.net} label={label("net")} />
            <LegendSwatch color={COLORS.assets} label={label("assets")} />
            <LegendSwatch color={COLORS.debts} label={label("debts")} />
            <span className="ml-auto">{t("pp_wealth_caveat")}</span>
          </div>
        </CardContent>
      </Card>

      {/* Composition over time (T3.6) — "of what", beneath "how much". Stacked as its own
          card rather than a tab, and handed the SAME series this section already fetched
          so it costs no extra request. Self-hides when the person declares no assets we
          can break down. */}
      <PersonPortfolioComposition series={model.series} />
    </DashboardSection>
  );
};
