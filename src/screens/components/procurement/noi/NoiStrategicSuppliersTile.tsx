// "На кого разчита НОИ" — the Tussell-style supplier-dependence bar: НОИ's few
// structural suppliers and the share of contract value they hold. The reason
// this needs a bespoke tile (not the generic top-contractors list) is context:
// НОИ's two biggest — Информационно обслужване (systems integrator by law) and
// Български пощи (pension delivery under an expiring statutory mandate) — have
// no competition BY STATUTE, not by choice. Without that chip their single-bid
// figures read as a red flag when they're the law. Pure from NoiSupplier[].
//
// Below the ranked list sits a Pareto concentration chart: suppliers sorted by
// € with a cumulative-% curve and 50%/80% reference lines — the aggregate read
// (how few suppliers hold the bulk of the spend) the per-row list can't show.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Users, Gavel, Truck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { PillToggle } from "@/components/ui/PillToggle";
import { formatEurCompact } from "@/lib/currency";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { useSeriesColors } from "../chartColors";
import { NOI_SUPPLIER_CONTEXT } from "@/lib/noiBenchmarks";
import type { NoiSupplier } from "@/lib/noiAttributes";

const TOP_N = 8;
// Pareto: cap the bar count so a long tail doesn't crush the axis; the rest
// collapse into one "останали" bucket that carries the curve to 100%.
const PARETO_N = 12;

type Metric = "value" | "count";

interface ParetoDatum {
  name: string;
  short: string;
  eur: number;
  cumPct: number;
}

const ParetoTooltip: FC<{
  active?: boolean;
  payload?: { payload: ParetoDatum }[];
  lang: string;
  bg: boolean;
}> = ({ active, payload, lang, bg }) => {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-2 py-1.5 text-popover-foreground shadow-sm text-xs">
      <div className="font-semibold max-w-[220px] truncate">{d.name}</div>
      <div className="tabular-nums">{formatEurCompact(d.eur, lang)}</div>
      <div className="text-muted-foreground tabular-nums">
        {d.cumPct.toLocaleString(lang, { maximumFractionDigits: 0 })}%{" "}
        {bg ? "натрупано" : "cumulative"}
      </div>
    </div>
  );
};

export const NoiStrategicSuppliersTile: FC<{
  suppliers: NoiSupplier[];
  totalEur: number;
}> = ({ suppliers, totalEur }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const series = useSeriesColors();
  const [metric, setMetric] = useState<Metric>("value");

  // Pareto data: all suppliers sorted by € desc, top PARETO_N kept, the rest
  // folded into one bucket; cumulative % runs across the FULL corpus so the
  // curve is honest (reaches 100% at the "останали" bucket).
  const pareto = useMemo<ParetoDatum[]>(() => {
    if (totalEur <= 0) return [];
    const sorted = [...suppliers].sort((a, b) => b.totalEur - a.totalEur);
    const head = sorted.slice(0, PARETO_N);
    const tail = sorted.slice(PARETO_N);
    const tailEur = tail.reduce((s, x) => s + x.totalEur, 0);
    const rows: { name: string; short: string; eur: number }[] = head.map(
      (s, i) => ({
        name: s.name,
        short: String(i + 1),
        eur: s.totalEur,
      }),
    );
    if (tailEur > 0)
      rows.push({
        name: bg ? `Останали (${tail.length})` : `Others (${tail.length})`,
        short: bg ? "ост." : "oth.",
        eur: tailEur,
      });
    let cum = 0;
    return rows.map((r) => {
      cum += r.eur;
      return { ...r, cumPct: (cum / totalEur) * 100 };
    });
  }, [suppliers, totalEur, bg]);

  if (suppliers.length < 2 || totalEur <= 0) return null;

  const byCount = metric === "count";
  const top = suppliers.slice(0, TOP_N);
  const topShare = top.reduce((s, x) => s + x.totalEur, 0) / totalEur;
  // `|| 1` guards against every supplier row being €0 (totalEur > 0 coming only
  // from eik-less rows) → avoids NaN bar widths.
  const metricOf = (s: NoiSupplier) => (byCount ? s.contractCount : s.totalEur);
  const max = Math.max(...top.map(metricOf)) || 1;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            {bg ? "На кого разчита НОИ" : "Who НОИ depends on"}
          </CardTitle>
          <PillToggle<Metric>
            ariaLabel={bg ? "Мярка" : "Metric"}
            value={metric}
            onChange={setMetric}
            options={[
              { value: "value", label: bg ? "Стойност" : "Value" },
              { value: "count", label: bg ? "Брой" : "Count" },
            ]}
          />
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-xl font-bold tabular-nums">
            {(topShare * 100).toLocaleString(lang, {
              maximumFractionDigits: 0,
            })}
            %
          </span>
          <span className="text-muted-foreground">
            {bg
              ? `от стойността на договорите отива към тези ${top.length} изпълнителя`
              : `of contract value goes to these ${top.length} suppliers`}
          </span>
        </div>

        <div className="space-y-2.5">
          {top.map((s) => {
            const ctx = NOI_SUPPLIER_CONTEXT[s.eik];
            const sb = s.singleBidShare;
            return (
              <div key={s.eik} className="text-xs">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <Link
                    to={`/company/${s.eik}`}
                    className="min-w-0 truncate font-medium hover:text-primary hover:underline"
                    title={s.name}
                  >
                    {s.name}
                  </Link>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {byCount
                      ? `${s.contractCount.toLocaleString(lang)} ${bg ? "договора" : "contracts"}`
                      : formatEurCompact(s.totalEur, lang)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${ctx ? "bg-amber-500" : "bg-primary"}`}
                    style={{
                      width: `${Math.max(2, (metricOf(s) / max) * 100)}%`,
                    }}
                  />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[11px] text-muted-foreground">
                    {s.contractCount} {bg ? "договора" : "contracts"}
                  </span>
                  {sb != null && s.bidKnownN >= 3 && !ctx && (
                    <span
                      className={`text-[11px] ${sb >= 0.5 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}
                    >
                      {(sb * 100).toLocaleString(lang, {
                        maximumFractionDigits: 0,
                      })}
                      % {bg ? "с една оферта" : "single-bid"}
                    </span>
                  )}
                  {ctx && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${WARN_CHIP_COLORS}`}
                    >
                      {ctx.kind === "statutory" ? (
                        <Gavel className="h-3 w-3" />
                      ) : (
                        <Truck className="h-3 w-3" />
                      )}
                      {bg ? ctx.bg : ctx.en}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pareto — the aggregate concentration curve. Bars = € per supplier
            (sorted desc), line = cumulative share; the 50%/80% guides read off
            how few suppliers hold the bulk of the spend. */}
        {pareto.length >= 3 && (
          <div className="pt-2 border-t">
            <div className="mb-1 text-xs font-medium">
              {bg ? "Концентрация на доставчиците" : "Supplier concentration"}
            </div>
            <div style={{ height: 220, width: "100%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={pareto}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    className="stroke-border"
                  />
                  <XAxis
                    dataKey="short"
                    tickLine={false}
                    axisLine={false}
                    fontSize={10}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(v: number) =>
                      v >= 1_000_000
                        ? `€${(v / 1_000_000).toFixed(0)}M`
                        : v >= 1_000
                          ? `€${(v / 1_000).toFixed(0)}k`
                          : `€${v}`
                    }
                    tickLine={false}
                    axisLine={false}
                    fontSize={10}
                    className="fill-muted-foreground"
                    width={48}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    tickLine={false}
                    axisLine={false}
                    fontSize={10}
                    className="fill-muted-foreground"
                    width={36}
                  />
                  <Tooltip
                    content={<ParetoTooltip lang={lang} bg={bg} />}
                    cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                  />
                  <ReferenceLine
                    yAxisId="right"
                    y={50}
                    strokeDasharray="4 3"
                    className="stroke-muted-foreground/50"
                    label={{
                      value: "50%",
                      position: "insideTopRight",
                      fontSize: 9,
                      className: "fill-muted-foreground",
                    }}
                  />
                  <ReferenceLine
                    yAxisId="right"
                    y={80}
                    strokeDasharray="4 3"
                    className="stroke-muted-foreground/50"
                    label={{
                      value: "80%",
                      position: "insideTopRight",
                      fontSize: 9,
                      className: "fill-muted-foreground",
                    }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="eur"
                    fill={series.amount}
                    radius={[2, 2, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="cumPct"
                    stroke={series.count}
                    strokeWidth={2}
                    dot={{ r: 2, fill: series.count }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Кехлибарените ленти маркират структурни доставчици, чието възлагане е определено със закон, а не от конкуренция — затова висок дял с една оферта при тях е нормативен, не сигнал за нарушение."
            : "Amber bars mark structural suppliers whose award is set by statute, not competition — so a high single-bid share for them is the law, not a red flag."}
        </p>
      </CardContent>
    </Card>
  );
};
