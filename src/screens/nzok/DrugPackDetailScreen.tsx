// Per-pack page (/molecule/:inn/pack/:nationalNo/:nzokCode). ONE pack identity of
// one medicine: its month-by-month unit-price dispersion (median with the p25–p75
// band) and every hospital that paid above the year median. The monthly trend is
// the one thing a single-year ranking cannot claim — PERSISTENT dispersion, not a
// lone month's ratio, is the defensible signal (see 052_nzok_drug_unit_prices.sql).
//
// A price gap is a SIGNPOST, not an irregularity: volume, delivery period and
// contract terms all legitimately move a unit price.

import { FC, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Coins, Building2, TrendingUp, Package } from "lucide-react";
import { Title } from "@/ux/Title";
import { StatCard } from "@/screens/dashboard/StatCard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { useNzokDrugPack } from "@/data/budget/useBudget";
import { formatEur, formatEurCompact } from "@/lib/currency";
import { decodeEntities } from "@/lib/decodeEntities";
import { FacilityLink } from "@/screens/components/procurement/nzok/FacilityLink";
import {
  moleculeHref,
  decodePackParam,
} from "@/screens/components/procurement/nzok/drugLinks";

interface TrendPoint {
  period: string;
  median: number;
  p25: number;
  p75: number;
  band: number; // p75 - p25, stacked on p25 to draw the dispersion band
  facilityCount: number;
}

export const DrugPackDetailScreen: FC = () => {
  const params = useParams<{
    inn: string;
    nationalNo: string;
    nzokCode: string;
  }>();
  const inn = (params.inn ?? "").toUpperCase();
  const nationalNo = decodePackParam(params.nationalNo);
  const nzokCode = decodePackParam(params.nzokCode);
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const { data, isLoading } = useNzokDrugPack(nationalNo, nzokCode);

  const trend = useMemo<TrendPoint[]>(
    () =>
      (data?.series ?? []).map((s) => ({
        period: s.period,
        median: s.medianUnitEur,
        p25: s.p25UnitEur,
        p75: s.p75UnitEur,
        band: Math.max(s.p75UnitEur - s.p25UnitEur, 0),
        facilityCount: s.facilityCount,
      })),
    [data],
  );

  const title = data ? decodeEntities(data.tradeName) || inn : inn;
  const packId = data?.nationalNo || data?.nzokCode || "";
  const maxRowRatio = data?.rows.reduce((m, r) => Math.max(m, r.ratio), 0) ?? 0;

  return (
    <>
      <Title
        description={
          bg
            ? `Движение по месеци на цената за единица на ${title} (${inn}) и болниците, платили над медианата. Източник: НЗОК „Справка 5".`
            : `Month-by-month unit price of ${title} (${inn}) and the hospitals that paid above median. Source: NHIF "Справка 5".`
        }
      >
        {title}
      </Title>

      {isLoading ? (
        <div className="my-6 h-40 animate-pulse rounded-xl border bg-card" />
      ) : !data ? (
        <p className="my-8 text-center text-muted-foreground">
          {bg ? "Няма данни за тази опаковка." : "No data for this pack."}
        </p>
      ) : (
        <section aria-label={title} className="my-4">
          <p className="-mt-2 mb-4 text-sm text-muted-foreground">
            <Link to={moleculeHref(inn)} className="uppercase hover:underline">
              {inn}
            </Link>
            {data.form ? ` · ${decodeEntities(data.form)}` : ""}
            {packId ? ` · ${packId}` : ""}
          </p>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={bg ? "Медиана/ед." : "Median/unit"}>
              <div className="flex items-baseline gap-2">
                <Coins className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {formatEur(data.medianUnitEur, L, { decimals: 2 })}
                </span>
              </div>
              <span className="mt-1 block text-xs text-muted-foreground">
                {data.latestPeriod}
              </span>
            </StatCard>
            <StatCard label={bg ? "Диапазон (p25–p75)" : "Range (p25–p75)"}>
              <span className="text-lg font-bold tabular-nums">
                {formatEur(data.p25UnitEur, L, { decimals: 2 })} –{" "}
                {formatEur(data.p75UnitEur, L, { decimals: 2 })}
              </span>
            </StatCard>
            <StatCard label={bg ? "Болници" : "Hospitals"}>
              <div className="flex items-baseline gap-2">
                <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {data.facilityCount}
                </span>
              </div>
              <span className="mt-1 block text-xs text-muted-foreground">
                {bg
                  ? `над прага от ${data.volumeFloorPacks} оп.`
                  : `past the ${data.volumeFloorPacks}-pack floor`}
              </span>
            </StatCard>
            <StatCard label={bg ? "Макс. отклонение" : "Max deviation"}>
              <div className="flex items-baseline gap-2">
                <TrendingUp className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="text-2xl font-bold tabular-nums">
                  {maxRowRatio > 0 ? `${maxRowRatio.toFixed(1)}×` : "—"}
                </span>
              </div>
            </StatCard>
          </div>

          {trend.length >= 2 && (
            <DashboardSection
              id="pack-trend"
              title={
                bg ? "Движение на цената по месеци" : "Unit price over time"
              }
              icon={TrendingUp}
            >
              <div className="rounded-xl border bg-card p-3 shadow-sm md:p-4">
                <p className="mb-3 text-xs text-muted-foreground">
                  {bg
                    ? "Медианната цена за единица и диапазонът p25–p75 между болниците по месеци. Устойчивото, а не еднократното отклонение е защитимият сигнал."
                    : "Median unit price and the p25–p75 spread between hospitals, by month. Persistent — not one-off — dispersion is the defensible signal."}
                </p>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={trend}
                      margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-border"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="period"
                        tick={{ fontSize: 12 }}
                        className="fill-muted-foreground"
                      />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickFormatter={(v) =>
                          formatEur(v as number, L, { decimals: 0 })
                        }
                        className="fill-muted-foreground"
                        domain={[
                          (min: number) => min - Math.abs(min) * 0.1,
                          (max: number) => max + Math.abs(max) * 0.1,
                        ]}
                        width={64}
                      />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload as TrendPoint;
                          return (
                            <div className="rounded-lg border bg-card px-3 py-2 text-xs text-card-foreground shadow-sm">
                              <div className="mb-1 font-medium">{label}</div>
                              <div className="tabular-nums">
                                {bg ? "Медиана" : "Median"}:{" "}
                                {formatEur(p.median, L, { decimals: 2 })}
                              </div>
                              <div className="tabular-nums text-muted-foreground">
                                p25–p75: {formatEur(p.p25, L, { decimals: 2 })}{" "}
                                – {formatEur(p.p75, L, { decimals: 2 })}
                              </div>
                              <div className="tabular-nums text-muted-foreground">
                                {bg ? "Болници" : "Hospitals"}:{" "}
                                {p.facilityCount}
                              </div>
                            </div>
                          );
                        }}
                      />
                      {/* Transparent base + shaded gap = the p25–p75 band. */}
                      <Area
                        type="monotone"
                        dataKey="p25"
                        stackId="band"
                        stroke="none"
                        fill="none"
                        isAnimationActive={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="band"
                        stackId="band"
                        stroke="none"
                        fill="hsl(var(--muted-foreground))"
                        fillOpacity={0.15}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="median"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </DashboardSection>
          )}

          <DashboardSection
            id="pack-hospitals"
            title={bg ? "Болници над медианата" : "Hospitals above median"}
            icon={Building2}
          >
            <div className="rounded-xl border bg-card p-3 shadow-sm md:p-4">
              {data.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {bg
                    ? "Нито една болница не е над медианата за тази опаковка."
                    : "No hospital paid above median for this pack."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-1.5 pr-2 text-left font-normal">
                          {bg ? "Болница" : "Hospital"}
                        </th>
                        <th className="py-1.5 pr-2 text-right font-normal">
                          {bg ? "Цена/ед." : "Unit"}
                        </th>
                        <th className="py-1.5 pr-2 text-right font-normal">
                          {bg ? "Медиана" : "Median"}
                        </th>
                        <th className="py-1.5 pr-2 text-right font-normal">
                          {bg ? "Опаковки" : "Packs"}
                        </th>
                        <th className="py-1.5 text-right font-normal">
                          {bg ? "Разлика" : "Gap"}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.rows.map((r, i) => (
                        <tr
                          key={`${r.regNo}|${i}`}
                          className="hover:bg-muted/40"
                        >
                          <td className="max-w-[18rem] truncate py-1.5 pr-2">
                            <FacilityLink eik={r.eik} name={r.facility} />
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {formatEur(r.unitEur, L, { decimals: 2 })}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                            {formatEur(r.medianUnitEur, L, { decimals: 2 })}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">
                            {Math.round(r.units).toLocaleString(
                              bg ? "bg-BG" : "en-US",
                            )}
                          </td>
                          <td className="py-1.5 text-right tabular-nums font-medium">
                            {r.ratio.toFixed(1)}×
                            <span className="block text-[10px] font-normal text-muted-foreground">
                              +{formatEurCompact(r.overpayEur, L)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </DashboardSection>

          <p className="mt-6 text-[11px] text-muted-foreground/80">
            {bg
              ? `Единичната цена = реимбурсна сума / (опаковки × брой в опаковка) за същата опаковка (Национален № ${data.nationalNo || "—"}). Включени са само доставки от поне ${data.volumeFloorPacks} опаковки. Ценовата разлика НЕ е нередност — може да отразява обем, срок на доставка или условия по договора. Източник: НЗОК „Справка 5" (Наредба 10/2009).`
              : `Unit price = reimbursed sum / (packs × pack size) for the identical pack (Национален № ${data.nationalNo || "—"}). Only deliveries of at least ${data.volumeFloorPacks} packs are included. A price gap is NOT an irregularity — it can reflect volume, delivery period or contract terms. Source: NHIF "Справка 5" (Наредба 10/2009).`}
          </p>

          <p className="mt-4 flex items-center justify-center gap-2 text-sm">
            <Package className="h-4 w-4 text-muted-foreground" />
            <Link
              to={moleculeHref(inn)}
              className="text-primary hover:underline"
            >
              ← <span className="uppercase">{inn}</span>{" "}
              {bg ? "— всички опаковки" : "— all packs"}
            </Link>
          </p>
        </section>
      )}
    </>
  );
};
