// "Динамика на болничните плащания" — the TIME dimension. this tile shows НЗОК's
// hospital-care spend month-by-month across every ingested year (2023→) plus a
// year-over-year comparison of the latest YTD figure against the same month last
// year, per facility. National trend + fastest movers, both drawn from the
// multi-period nzok_hospital_payments corpus. Pure from NzokHospitalTrendsFile.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TrendingUp, TrendingDown, ArrowRight } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { spendDeltaClass } from "@/lib/spendDelta";
import { decodeEntities } from "@/lib/decodeEntities";
import { ownershipChipClass, ownershipLabel } from "@/lib/nzokOwnership";
import { monthYearLabel } from "@/lib/monthNames";
import { tooltipSurfaceCompactClass } from "@/components/ui/tooltipSurface";
import type {
  NzokHospitalTrendsFile,
  NzokFacilityMomentum,
} from "@/data/budget/types";

// We only rank facilities whose prior-year base clears data.moverBaseFloorEur
// (~€2M ≈ a mid-size hospital), so a €5k→€60k facility can't masquerade as a 12×
// "gain". That floor is single-sourced from the SQL payload (see below) so it
// stays in lockstep with the /company percentile badge's peer set.
const MOVERS_N = 5;

const parsePeriod = (p: string): { year: number; month: number } => {
  const [y, m] = p.split("-");
  return { year: Number(y), month: Number(m) };
};

// Latest year in full health-teal; older years fade back so the year boundaries
// read at a glance without a legend.
const yearColor = (year: number, latestYear: number): string => {
  const age = latestYear - year;
  if (age <= 0) return "rgb(13 148 136)"; // teal-600
  if (age === 1) return "rgb(45 165 155)";
  if (age === 2) return "rgb(148 163 184)"; // slate-400
  return "rgb(203 213 225)"; // slate-300
};

type ChartRow = {
  period: string;
  label: string;
  monthEur: number;
  year: number;
  color: string;
};

type TooltipPayload = {
  active?: boolean;
  payload?: { payload: ChartRow }[];
};

export const NzokHospitalMomentumTile: FC<{
  data: NzokHospitalTrendsFile;
}> = ({ data }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);

  const latestYear = useMemo(
    () => parsePeriod(data.currentPeriod).year,
    [data.currentPeriod],
  );

  const rows = useMemo<ChartRow[]>(
    () =>
      data.national.map((pt) => {
        const { year, month } = parsePeriod(pt.period);
        return {
          period: pt.period,
          label: monthYearLabel(month, year, lang),
          monthEur: pt.monthEur,
          year,
          color: yearColor(year, latestYear),
        };
      }),
    [data.national, lang, latestYear],
  );

  // Year-over-year national delta (spend now vs same YTD point a year ago).
  const yoy = useMemo(() => {
    if (!data.hasPriorYear || !data.priorYtdEur) return null;
    const delta = data.currentYtdEur / data.priorYtdEur - 1;
    return { delta, prior: data.priorYtdEur };
  }, [data.currentYtdEur, data.priorYtdEur, data.hasPriorYear]);

  // Fastest movers by YoY %, above the base floor so tiny-base noise is excluded.
  const { gainers, decliners } = useMemo(() => {
    const withDelta = data.facilities
      .filter(
        (f): f is NzokFacilityMomentum & { priorYtdEur: number } =>
          f.priorYtdEur != null && f.priorYtdEur >= data.moverBaseFloorEur,
      )
      .map((f) => ({ ...f, delta: f.currentYtdEur / f.priorYtdEur - 1 }));
    const sorted = [...withDelta].sort((a, b) => b.delta - a.delta);
    return {
      gainers: sorted.filter((f) => f.delta > 0).slice(0, MOVERS_N),
      decliners: sorted
        .filter((f) => f.delta < 0)
        .slice(-MOVERS_N)
        .reverse(),
    };
  }, [data.facilities, data.moverBaseFloorEur]);

  // One X tick per year — the first ingested period of each calendar year — so
  // the axis reads "2023 2024 2025 2026" instead of repeating labels.
  const yearTicks = useMemo(() => {
    const seen = new Set<number>();
    const ticks: string[] = [];
    for (const r of rows) {
      if (!seen.has(r.year)) {
        seen.add(r.year);
        ticks.push(r.period);
      }
    }
    return ticks;
  }, [rows]);

  if (rows.length < 2) return null;

  const period = (() => {
    const { year, month } = parsePeriod(data.currentPeriod);
    return monthYearLabel(month, year, lang);
  })();

  const pct = (v: number, signed = false) =>
    `${signed && v > 0 ? "+" : ""}${(v * 100).toLocaleString(lang, {
      maximumFractionDigits: 1,
    })}%`;

  const ChartTooltip: FC<TooltipPayload> = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null;
    const r = payload[0].payload;
    return (
      <div className={tooltipSurfaceCompactClass}>
        <div className="font-semibold">{r.label}</div>
        <div className="tabular-nums">{eur(r.monthEur)}</div>
        <div className="text-[10px] text-muted-foreground">
          {bg ? "изплатено през месеца" : "paid in month"}
        </div>
      </div>
    );
  };

  const MoverRow: FC<{ f: NzokFacilityMomentum & { delta: number } }> = ({
    f,
  }) => {
    return (
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-baseline gap-1.5">
          {f.eik ? (
            <Link
              to={`/company/${f.eik}`}
              className="min-w-0 truncate font-medium text-accent hover:underline"
            >
              {decodeEntities(f.name)}
            </Link>
          ) : (
            <span className="min-w-0 truncate font-medium">
              {decodeEntities(f.name)}
            </span>
          )}
          {f.ownership && (
            <span
              className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium leading-none ${ownershipChipClass(
                f.ownership,
              )}`}
            >
              {ownershipLabel(f.ownership, bg)}
            </span>
          )}
        </span>
        <span className="shrink-0 tabular-nums">
          <span className="text-muted-foreground">{eur(f.currentYtdEur)}</span>
          <span className={`ml-1.5 font-semibold ${spendDeltaClass(f.delta)}`}>
            {pct(f.delta, true)}
          </span>
        </span>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          {bg ? "Динамика на болничните плащания" : "Hospital-payment momentum"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        {/* YoY headline */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums">
            {eur(data.currentYtdEur)}
          </span>
          {yoy ? (
            <span className="text-sm text-muted-foreground">
              {bg ? `изплатени до ${period} — ` : `paid through ${period} — `}
              <span className={`font-semibold ${spendDeltaClass(yoy.delta)}`}>
                {pct(yoy.delta, true)}
              </span>{" "}
              {bg
                ? `спрямо същия период на ${data.priorPeriod.slice(0, 4)} г. (${eur(
                    yoy.prior,
                  )})`
                : `vs the same period of ${data.priorPeriod.slice(0, 4)} (${eur(
                    yoy.prior,
                  )})`}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">
              {bg ? `изплатени до ${period}` : `paid through ${period}`}
            </span>
          )}
        </div>

        {/* National monthly trend across all ingested years */}
        <div className="w-full h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                opacity={0.15}
              />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                ticks={yearTicks}
                tickFormatter={(p: string) => p.slice(0, 4)}
              />
              <YAxis
                tick={{ fontSize: 9 }}
                tickLine={false}
                axisLine={false}
                width={38}
                tickFormatter={(v: number) => eur(v)}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: "rgba(148,163,184,0.12)" }}
              />
              <Bar dataKey="monthEur" radius={[2, 2, 0, 0]}>
                {rows.map((r) => (
                  <Cell key={r.period} fill={r.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Fastest movers — the transparent, published-formula answer to the
            competitor's black-box "AI anomaly" flags. */}
        {(gainers.length > 0 || decliners.length > 0) && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-1">
            {gainers.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-rose-600 dark:text-rose-400">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {bg ? "Най-голям ръст" : "Fastest rising"}
                </div>
                {gainers.map((f) => (
                  <MoverRow key={f.regNo} f={f} />
                ))}
              </div>
            )}
            {decliners.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                  <TrendingDown className="h-3.5 w-3.5" />
                  {bg ? "Най-голям спад" : "Fastest falling"}
                </div>
                {decliners.map((f) => (
                  <MoverRow key={f.regNo} f={f} />
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80 flex items-start gap-1">
          <ArrowRight className="h-3 w-3 mt-0.5 shrink-0" />
          {bg
            ? `Ръст/спад = натрупано плащане до ${period} спрямо същия месец на предходната година; показани са лечебни заведения с база над ${eur(
                data.moverBaseFloorEur,
              )}, за да не се раздуват процентите от малки суми.`
            : `Rise/fall = year-to-date payment through ${period} vs the same month a year earlier; only facilities above a ${eur(
                data.moverBaseFloorEur,
              )} base are ranked, so small-sum swings don't inflate the percentages.`}
        </p>
      </CardContent>
    </Card>
  );
};
