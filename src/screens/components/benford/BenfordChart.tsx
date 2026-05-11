import { FC, useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import type { BenfordTest } from "@/data/benford/useBenford";
import { formatPct } from "@/data/utils";

// One Benford chart — observed first-digit shares as bars + the
// Benford-expected curve as a line overlay. Per UX research: bar+line,
// NOT bar+bar (overlapping bars confuse). Compact variant (`small`) is
// for the small-multiples grid; the full variant for the detail view.

type Mode = "first" | "second";

const TooltipContent: FC<{
  active?: boolean;
  payload?: Array<{
    payload?: { digit: number; observed: number; expected: number };
  }>;
  mode: Mode;
}> = ({ active, payload, mode }) => {
  const { t } = useTranslation();
  if (!active || !payload?.length || !payload[0].payload) return null;
  const { digit, observed, expected } = payload[0].payload;
  return (
    <div className="rounded-md border bg-card px-2 py-1.5 text-xs shadow-sm">
      <div className="font-semibold">
        {mode === "first"
          ? t("benford_digit_first") + " " + digit
          : t("benford_digit_second") + " " + digit}
      </div>
      <div className="text-muted-foreground">
        {t("benford_observed")}:{" "}
        <span className="font-mono">{formatPct(observed * 100, 2)}</span>
      </div>
      <div className="text-muted-foreground">
        {t("benford_expected")}:{" "}
        <span className="font-mono">{formatPct(expected * 100, 2)}</span>
      </div>
    </div>
  );
};

export const BenfordChart: FC<{
  test?: BenfordTest;
  mode: Mode;
  color?: string;
  small?: boolean;
}> = ({ test, mode, color = "hsl(var(--foreground))", small = false }) => {
  const data = useMemo(() => {
    if (!test) return [];
    const baseDigit = mode === "first" ? 1 : 0;
    return test.observed.map((o, i) => ({
      digit: baseDigit + i,
      observed: o,
      expected: test.expected[i],
    }));
  }, [test, mode]);

  if (!test || !data.length) {
    return (
      <div
        className={
          small
            ? "flex items-center justify-center h-[88px] text-[10px] text-muted-foreground"
            : "flex items-center justify-center h-32 text-xs text-muted-foreground"
        }
      >
        —
      </div>
    );
  }

  const height = small ? 88 : 220;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        margin={{
          top: 4,
          right: 4,
          bottom: small ? 0 : 12,
          left: small ? 0 : 4,
        }}
      >
        {!small && (
          <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
        )}
        <XAxis
          dataKey="digit"
          tick={{
            fontSize: small ? 8 : 11,
            fill: "hsl(var(--muted-foreground))",
          }}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <YAxis
          hide={small}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickLine={false}
          axisLine={false}
        />
        {!small && (
          <Tooltip content={<TooltipContent mode={mode} />} cursor={false} />
        )}
        <Bar
          dataKey="observed"
          fill={color}
          fillOpacity={0.75}
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          dataKey="expected"
          type="monotone"
          stroke="hsl(var(--foreground))"
          strokeWidth={small ? 1.25 : 2}
          dot={
            small
              ? false
              : {
                  fill: "hsl(var(--foreground))",
                  r: 2.5,
                  strokeWidth: 0,
                }
          }
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
};
