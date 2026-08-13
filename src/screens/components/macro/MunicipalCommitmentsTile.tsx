// The three municipal liability stocks on /indicators/fiscal — the aggregate
// half of the per-município corpus (migration 149).
//
// It sits on this page rather than on a governance dashboard because the
// question it answers is national: how big is the money 265 municipalities have
// already contracted for later budget years, next to the cash the state holds?
//
// Three rules govern what may be drawn here, and each closes a way this figure
// invites being read wrongly:
//
//   1. **Never stacked, summed or netted against the deficit, the debt or the
//      reserve.** The consolidated cash deficit books a municipal payment when
//      it is MADE, so these stocks are invisible in the national numbers until
//      paid — they are an adjacent fact, not a component. The fiscal reserve
//      appears only as a sentence of context beside the chart, never as a
//      series in it.
//   2. **Same-quarter comparison only.** These are stocks, not flows; a
//      commitment stock at Q2 against a reserve at Q4 compares two different
//      days.
//   3. **No município names and no map.** This page is the national aggregate;
//      the per-município view is T10.1 (/governance/municipal-finance) and does
//      not exist yet — hence no outbound link, see the note at the foot.
//
// The bars are drawn side by side, never stacked, for a fourth reason of their
// own: the three stocks NEST (commitments ⊃ obligations ⊃ arrears is the
// conceptual order, though the published columns are measured separately), so a
// stack would triple-count the same lev.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMacro } from "@/data/macro/useMacro";
import {
  buildRows,
  fmtEurM,
  latestPerStock,
  latestSharedQuarter,
  STOCKS,
  type ChartRow,
  type StockPoint,
} from "./municipalStocks";
import { tooltipSurfaceClass } from "@/components/ui/tooltipSurface";
import { cn } from "@/lib/utils";

const TooltipContent: FC<{
  active?: boolean;
  payload?: { payload: ChartRow }[];
}> = ({ active, payload }) => {
  const { t, i18n } = useTranslation();
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className={cn(tooltipSurfaceClass, "text-xs")}>
      <div className="font-semibold mb-1">{row.period}</div>
      {STOCKS.map(({ key, color }) =>
        row[key] == null ? null : (
          <div key={key} className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="flex-1">{t(`municipal_fiscal_${key}`)}</span>
            <span className="font-medium tabular-nums">
              {fmtEurM(row[key] as number, i18n.language)}
            </span>
          </div>
        ),
      )}
      {row.count != null && (
        <div className="mt-1 text-muted-foreground">
          {t("municipal_fiscal_reporting_count", { count: row.count })}
          {row.partial && ` · ${t("municipal_fiscal_partial")}`}
        </div>
      )}
    </div>
  );
};

export const MunicipalCommitmentsTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { data } = useMacro();

  const rows = useMemo(
    () =>
      data
        ? buildRows({
            municipalCommitments: data.series.municipalCommitments,
            municipalExpenseObligations:
              data.series.municipalExpenseObligations,
            municipalArrears: data.series.municipalArrears,
          })
        : [],
    [data],
  );

  // The headline: commitments against the fiscal reserve, at the newest quarter
  // where both exist. Not a ratio of like to like — one is a municipal
  // liability, the other central cash — which is why the caption says "for
  // scale" rather than presenting it as coverage.
  const scale = useMemo(
    () =>
      data
        ? latestSharedQuarter(
            data.series.municipalCommitments as StockPoint[] | undefined,
            data.series.fiscalReserve,
          )
        : null,
    [data],
  );

  if (!data || rows.length === 0) return null;

  // Per stock, not per row: the newest quarter is routinely one where МФ froze
  // the commitments column, and a card reading the last row would print „—" for
  // the two figures this tile is mainly about.
  const latest = latestPerStock(rows);
  // Rule 2 says stocks may only be compared at the same quarter, and the cards
  // are the one place that rule is bent (a withheld column would otherwise
  // print „—" for the two figures the tile is about). Say so, rather than
  // leaving it to three 11px date labels the eye skips.
  const mixedQuarters =
    new Set(Object.values(latest).map((p) => p.period)).size > 1;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        {STOCKS.map(({ key, color }) => {
          const point = latest[key];
          return (
            <div key={key} className="rounded-lg border p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: color }}
                />
                {t(`municipal_fiscal_${key}`)}
              </div>
              <div className="text-2xl font-semibold tabular-nums mt-1">
                {point == null ? "—" : fmtEurM(point.value, i18n.language)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {point == null
                  ? t("municipal_fiscal_never_published")
                  : t("municipal_fiscal_as_of", { period: point.period })}
              </div>
            </div>
          );
        })}
      </div>

      {mixedQuarters && (
        <p className="text-[11px] text-muted-foreground -mt-2 mb-3">
          {t("municipal_fiscal_mixed_quarters")}
        </p>
      )}

      {scale && (
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("municipal_fiscal_vs_reserve", {
            period: scale.period,
            commitments: fmtEurM(scale.a, i18n.language),
            reserve: fmtEurM(scale.b, i18n.language),
            pct: Math.round((scale.a / scale.b) * 100),
          })}
        </p>
      )}

      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}`}
              label={{
                value: t("municipal_fiscal_axis_bn"),
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11 },
              }}
            />
            <Tooltip content={<TooltipContent />} />
            {/* Grouped, never stacked — the stocks nest, so a stack would
                triple-count the same lev. */}
            {STOCKS.map(({ key, color }) => (
              // `isAnimationActive={false}` matches every other chart in this
              // folder, and here it is load-bearing rather than a preference:
              // with the mount animation on, the bar rectangles render EMPTY —
              // present in the DOM, drawing nothing — so the chart reads as a
              // quarter with no money in it.
              <Bar
                key={key}
                dataKey={key}
                fill={color}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* NO per-município link yet. `/governance/municipal-finance` is T10.1 and
          does not exist — and `routes.tsx` declares a catch-all
          `governance/:id`, so linking there today does not 404: it renders the
          place dashboard's „unknown place: municipal-finance" state at a 200.
          Add the link in the same commit as the page. */}
      <p className="text-xs text-muted-foreground mt-3 max-w-3xl">
        {t("municipal_fiscal_not_a_component")}
      </p>
    </div>
  );
};
