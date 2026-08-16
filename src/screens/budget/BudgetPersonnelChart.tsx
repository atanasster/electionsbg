// The establishment over time — filled posts as bars, the approved total as a
// line, and the vacancy rate on its own axis.
//
// Plan: docs/plans/budget-hub-v1.md T9.7. The plan calls this a „sparkline";
// it is deliberately NOT one. The repo's standing rule is that an axis-less
// squiggle carries shape and no readable value, and these pages are read for
// numbers. The pre-migration tile drew a fully axed ComposedChart and this
// restores that shape.
//
// TWO AXIS DECISIONS, both load-bearing:
//
//   * THE LEFT AXIS DOES NOT START AT ZERO, and the page says so. The
//     establishment moves ~5% across nine years (139 665 → 145 623), so a
//     zero-based axis renders nine identical bars and the series says nothing.
//     A truncated axis overstates change, which is why the caption names it
//     rather than leaving a reader to notice the tick labels.
//   * THE VACANCY RATE GETS ITS OWN AXIS AND STARTS AT ZERO. It is a
//     percentage, so it shares no scale with a headcount — and unlike the
//     headcount, zero is meaningful for it.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildPersonnelSeries,
  type PersonnelDatum,
} from "./budgetPersonnelSeries";
import type { BudgetPersonnelPoint } from "@/data/budget/useBudgetPersonnel";

const compactN = (v: number): string =>
  Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v);

const ChartTooltip: FC<{
  active?: boolean;
  payload?: Array<{ payload: PersonnelDatum }>;
}> = ({ active, payload }) => {
  const { t, i18n } = useTranslation();
  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.language === "bg" ? "bg-BG" : "en-GB"),
    [i18n.language],
  );
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-semibold tabular-nums">{d.year}</div>
      {d.total != null ? (
        <div className="mt-1 tabular-nums">
          <span className="text-muted-foreground">
            {t("budget_staff_total")}:{" "}
          </span>
          {nf.format(d.total)}
        </div>
      ) : null}
      {d.filled != null ? (
        <div className="tabular-nums">
          <span className="text-muted-foreground">
            {t("budget_staff_filled")}:{" "}
          </span>
          {nf.format(d.filled)}
        </div>
      ) : null}
      {d.vacantPct != null ? (
        <div className="tabular-nums">
          <span className="text-muted-foreground">
            {t("budget_staff_chart_vacant_pct")}:{" "}
          </span>
          {d.vacantPct.toFixed(1)}%
        </div>
      ) : null}
    </div>
  );
};

export const BudgetPersonnelChart: FC<{
  points: BudgetPersonnelPoint[];
  className?: string;
}> = ({ points, className }) => {
  const { t } = useTranslation();

  const data = useMemo(() => buildPersonnelSeries(points), [points]);

  if (data.length < 2) return null;

  return (
    <div className={className}>
      {/* ARIA-HIDDEN, and this is the chart that most needs it — the opposite
          way round from the sibling COFOG chart's note. Recharts renders axis
          ticks as real SVG <text>, so without this a screen reader reads every
          year and tick value off the plot AND then the same nine rows again off
          the table below, which exists precisely because the SVG does not
          expose the pairs. One reading, from the table. */}
      <div aria-hidden="true" style={{ height: 200, width: "100%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              className="stroke-border"
            />
            <XAxis
              dataKey="year"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              className="fill-muted-foreground"
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              className="fill-muted-foreground"
              width={44}
              tickFormatter={compactN}
              domain={[
                (min: number) => Math.floor((min - 5000) / 5000) * 5000,
                (max: number) => Math.ceil((max + 2000) / 5000) * 5000,
              ]}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              className="fill-muted-foreground"
              width={34}
              tickFormatter={(v) => `${v}%`}
              // Zero-based, and a floor of 12 so a normal year does not fill
              // the axis and read as a crisis.
              domain={[0, (max: number) => Math.max(12, Math.ceil(max + 2))]}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
            />
            <Bar
              yAxisId="left"
              dataKey="filled"
              fill="hsl(var(--primary))"
              opacity={0.55}
              radius={[2, 2, 0, 0]}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="total"
              // NOT `--foreground`: it resolves to the same colour as
              // `--primary` in light mode, so the total line and the filled
              // bars were indistinguishable there. A darker green keeps the
              // pair related — both are „posts" — while separating them.
              stroke="#065f46"
              strokeWidth={1.75}
              dot={{ r: 2 }}
              isAnimationActive={false}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="vacantPct"
              stroke="hsl(var(--destructive))"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={{ r: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {/* THE NUMBERS, FOR ANYTHING THAT CANNOT SEE THE CHART. The `<ul>` this
          replaced put every year and value in the accessibility tree; an SVG
          of paths and rects does not, so the nine pairs would simply have gone
          missing for a screen reader. Visually hidden, semantically a table.

          ⚠️ THE `sr-only` IS ON A WRAPPING <div>, NOT ON THE <table>, and that is
          a layout fix rather than a style preference. CSS `width` on a table is
          a MINIMUM, not a maximum — a table lays out at min-content regardless —
          so `sr-only`'s `width:1px` did not shrink it, and although
          `position:absolute` took it out of flow it still contributed to the
          document's scrollable overflow. Measured at a 375px viewport:
          scrollWidth 514 against clientWidth 375, i.e. 139px of empty sideways
          scroll on every phone, from an element nobody can see. A block wrapper
          honours the 1px and its `overflow:hidden` contains the table. */}
      <div className="sr-only">
        <table>
          <caption>{t("budget_staff_trend_h")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("budget_comp_asof")}</th>
              <th scope="col">{t("budget_staff_total")}</th>
              <th scope="col">{t("budget_staff_filled")}</th>
              <th scope="col">{t("budget_staff_chart_vacant_pct")}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.year}>
                <th scope="row">{d.year}</th>
                <td>{d.total ?? "—"}</td>
                <td>{d.filled ?? "—"}</td>
                <td>
                  {d.vacantPct == null ? "—" : `${d.vacantPct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* A legend in words, because three series on two axes cannot be told
          apart from their colours alone at this size. */}
      <p className="mt-1 text-[11px] text-muted-foreground/80">
        {t("budget_staff_chart_legend")}
      </p>
    </div>
  );
};
