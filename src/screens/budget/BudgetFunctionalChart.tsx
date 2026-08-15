// The COFOG shares, as a chart with a real axis.
//
// Plan: docs/plans/budget-hub-v1.md T9.1. The page ranked ten functions as
// `<div>` bars scaled to the LARGEST share rather than to the whole — so
// „Социална закрила" filled the row at 36.8% and every other function was drawn
// as a fraction OF IT. That is a ranking encoding wearing a share encoding's
// clothes, on a page whose entire subject is how the total divides.
//
// A BAR CHART, NOT A DONUT, and the reason is the category count. The
// composition donut (T9.6) collapses its tail into „Други" past seven slices,
// and its eight-colour palette repeats after that. Here the bottom three are
// Жилищно строителство (2.6%), Култура, отдих и религия (1.8%) and Опазване на
// околната среда (1.6%) — 6.0% between them and three policy areas a reader may
// have come specifically to find. Length encodes the share, so nothing needs a
// colour vocabulary and nothing has to be hidden.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { truncateTick, type FunctionalBar } from "./budgetFunctionalBars";

/** ONE colour. An earlier draft alternated two lightnesses of teal so adjacent
 *  rows would separate — but Recharts already gaps the bars, the two were
 *  1.35:1 apart (invisible), and the darker of them was 2.62:1 against the dark
 *  background, i.e. below the 3:1 that WCAG 1.4.11 asks of a graphical object.
 *  The encoding is LENGTH; a second colour implied a meaning it did not carry. */
const BAR = "#0e7490";

interface TickProps {
  x?: number;
  y?: number;
  payload?: { value?: string };
}

/** `fill-muted-foreground`, not a literal — both sibling charts in this
 *  directory are theme-aware and Recharts' own default (#666) is 3.31:1 on the
 *  dark background. Here the Y tick is the ONLY thing naming a bar. */
const CategoryTick: FC<TickProps> = ({ x, y, payload }) => {
  const full = payload?.value ?? "";
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fontSize={11}
      className="fill-muted-foreground"
    >
      <title>{full}</title>
      {truncateTick(full)}
    </text>
  );
};

const FunctionalTooltip: FC<{
  active?: boolean;
  payload?: Array<{ payload: FunctionalBar }>;
}> = ({ active, payload }) => {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-semibold">{d.label}</div>
      {/* ⚠️ THE SHARE IS LABELLED AND SUBORDINATE. On `?basis=gdp` the amount is
          ALSO a percentage, so „1.4% · 36.8%" put %-of-GDP beside %-of-total in
          the same weight with nothing saying which was which. The donut's
          version of this line cannot hit that, because its first slot is always
          a euro figure. */}
      <div className="mt-0.5 tabular-nums">
        {d.amountLabel}
        <span className="ml-2 text-muted-foreground">
          {d.pct.toFixed(1)}% {t("budget_func_share_of_total")}
        </span>
      </div>
    </div>
  );
};

export const BudgetFunctionalChart: FC<{
  bars: FunctionalBar[];
  className?: string;
}> = ({ bars, className }) => {
  const { t } = useTranslation();
  if (bars.length === 0) return null;

  return (
    <figure className={className}>
      {/* A HEADING, like every other chart in the module. The chart is
          aria-hidden, so this is what tells a sighted reader what the picture
          is before they parse it. */}
      <figcaption className="mb-1 text-xs font-medium text-muted-foreground">
        {t("budget_func_chart_h")}
      </figcaption>
      {/* ARIA-HIDDEN, and no `sr-only` twin — unlike the personnel chart, which
          REPLACED its list. Here the ranked `<ul>` stays directly below with
          every label, figure and share, so a second copy would make a screen
          reader read all ten functions twice and would double every
          `findByText` on the page. */}
      <div
        aria-hidden="true"
        style={{ height: Math.max(200, bars.length * 30), width: "100%" }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={bars}
            layout="vertical"
            margin={{ top: 4, right: 44, bottom: 4, left: 4 }}
          >
            {/* THE AXIS IS THE POINT. Domain [0, 100] rather than [0, dataMax]:
                these are shares of one total, so a peak-relative scale makes the
                largest look like the whole budget and every other one a fraction
                of it. `allowDataOverflow={false}` so a share that somehow
                exceeded 100 would extend the axis rather than draw a bar past
                its own frame. */}
            <XAxis
              type="number"
              domain={[0, 100]}
              allowDataOverflow={false}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={150}
              interval={0}
              axisLine={false}
              tickLine={false}
              tick={<CategoryTick />}
            />
            <Tooltip
              content={<FunctionalTooltip />}
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.35 }}
            />
            <Bar
              dataKey="pct"
              fill={BAR}
              isAnimationActive={false}
              radius={[0, 2, 2, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
};
