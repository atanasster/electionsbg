// The composition donut — where the money came from, by share.
//
// Plan: docs/plans/budget-hub-v1.md T9.6. The pre-migration screen led its
// composition section with this; the migrated page ranks four coarse groups as
// bars instead, so „Данъчни приходи" — 86% of the section — was the answer to
// „where does the money come from".
//
// THE LEGEND IS THE CHART. A donut alone is unreadable: nobody can compare two
// arcs, and Recharts' own labels collide below ~8%. So every slice is also a
// row with its figure and its share, and the arc is what makes the ranking
// visible at a glance. Sorting is by value, so the legend order IS the ranking.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatEur } from "@/lib/currency";
import { slicesTotal, type Slice } from "./budgetSlices";

/** Eight steps. „Adjacent wedges differ" is the easy property and NOT the one
 *  that matters — a first draft satisfied it while pairing violet #8b5cf6 with
 *  indigo #6366f1 (ΔE 3.3 protan / 3.4 deutan: indistinguishable to red-green
 *  colour blindness, ~8% of men) and teal #14b8a6 with the tail's slate
 *  (ΔE 7.8 deutan). This set is spread on LIGHTNESS as well as hue, so the
 *  ordering survives when the hue does not — and the legend beside the chart
 *  carries every figure regardless, which is the real accommodation.
 *
 *  The last entry is the collapsed tail: the least saturated, because it is our
 *  aggregate rather than a line anybody published. */
const COLORS = [
  "#065f46", // deep green
  "#0ea5e9", // sky
  "#7c3aed", // violet
  "#f59e0b", // amber
  "#9f1239", // deep rose
  "#67e8f9", // pale cyan
  "#a16207", // ochre
  "#94a3b8", // slate — the tail
];

const colorFor = (i: number, isOther: boolean): string =>
  isOther ? COLORS[COLORS.length - 1] : COLORS[i % (COLORS.length - 1)];

const DonutTooltip: FC<{
  active?: boolean;
  payload?: Array<{ payload: Slice & { pct: number; label: string } }>;
}> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-semibold">{d.label}</div>
      <div className="mt-0.5 tabular-nums">
        {formatEur(d.value)} · {d.pct.toFixed(1)}%
      </div>
    </div>
  );
};

export const BudgetDonut: FC<{
  slices: Slice[];
  className?: string;
}> = ({ slices, className }) => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";

  const total = slicesTotal(slices);
  const data = useMemo(
    () =>
      slices.map((s) => ({
        ...s,
        label: bg ? s.labelBg : s.labelEn,
        // AGAINST THE SLICES' OWN SUM, never the section total: zero and
        // negative lines are dropped when the slices are built, so on a section
        // carrying a negative reserve the two differ and the shares would not
        // reach 100%.
        pct: total > 0 ? (s.value / total) * 100 : 0,
      })),
    [slices, bg, total],
  );

  if (slices.length === 0) return null;

  return (
    <div className={className}>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-center">
        <div style={{ height: 200, width: "100%" }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius="55%"
                outerRadius="90%"
                paddingAngle={1}
                stroke="none"
                // NO on-arc labels. Below ~8% they overlap their neighbours and
                // Recharts does not resolve the collision — the legend beside
                // this carries every figure anyway.
                isAnimationActive={false}
              >
                {data.map((d, i) => (
                  <Cell key={d.labelBg} fill={colorFor(i, d.isOther)} />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="space-y-1">
          {data.map((d, i) => (
            <li
              key={d.labelBg}
              className="flex items-baseline gap-2 text-xs"
              title={d.label}
            >
              <span
                className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: colorFor(i, d.isOther) }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">
                {d.label}
                {/* The tail says how many lines it folds, so „Други" is not
                    mistaken for a line the Ministry publishes. */}
                {d.isOther ? (
                  <span className="ml-1 text-muted-foreground">
                    {/* A PLURAL key, not an interpolated count: expenditure
                        folds exactly ONE line into the tail in every year, so
                        „(1 пера)" was the live rendering. */}
                    {t(
                      d.lineCount === 1
                        ? "budget_donut_other_n_one"
                        : "budget_donut_other_n_other",
                      { count: d.lineCount, defaultValue: "" },
                    )}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatEur(d.value)}
              </span>
              <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                {d.pct.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
