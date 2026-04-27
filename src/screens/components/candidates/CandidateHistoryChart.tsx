import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatThousands, localDate } from "@/data/utils";
import { useRegions } from "@/data/regions/useRegions";
import { CandidateStatsYearly } from "@/data/dataTypes";

const CustomTooltip: FC<{
  active?: boolean;
  payload?: {
    value: number;
    payload: {
      date: string;
      party: string;
      preferences: { region_name: string; preferences: number }[];
    };
  }[];
}> = ({ active, payload }) => {
  const { t } = useTranslation();

  return active && payload?.[0] ? (
    <div className="z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow">
      <div className="flex flex-col items-start gap-1">
        <div className="font-semibold">{`${payload[0].payload.date} · ${payload[0].payload.party}`}</div>
        {payload[0].payload.preferences
          .sort((a, b) => (b.preferences || 0) - (a.preferences || 0))
          .map((p, index) => {
            return (
              <div key={`region_${index}`} className="flex gap-1">
                <div className="text-primary-foreground/70">
                  {p.region_name}
                  {":"}
                </div>
                <div className="font-semibold tabular-nums">
                  {formatThousands(p.preferences)}
                </div>
                <div className="text-primary-foreground/60 lowercase">
                  {t("pref.")}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  ) : null;
};

export const CandidateHistoryChart: FC<{
  stats: CandidateStatsYearly[];
}> = ({ stats }) => {
  const { i18n } = useTranslation();
  const { findRegion } = useRegions();

  const { chartData, numRegions } = useMemo(() => {
    let numRegions = 0;
    const chartData = stats
      ?.filter((s) => s.preferences.length)
      ?.map((s) => {
        numRegions = Math.max(numRegions, s.preferences.length);
        const results = {
          date: localDate(s.elections_date),
          name: s.elections_date,
          party: s.party?.nickName,
          color: s.party?.color,
          preferences: s.preferences
            .sort((a, b) => (a.preferences || 0) - (b.preferences || 0))
            .map((p) => {
              const region = findRegion(p.oblast);
              return {
                ...p,
                region_name:
                  i18n.language === "bg" ? region?.name : region?.name_en,
              };
            }),
        };
        return results;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return { chartData, numRegions };
  }, [findRegion, i18n.language, stats]);

  return (
    <ChartContainer
      config={{}}
      className="aspect-auto h-[260px] w-full justify-stretch"
    >
      <BarChart
        accessibilityLayer
        data={chartData}
        barCategoryGap="22%"
        barGap={3}
        margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          interval={0}
          angle={-30}
          textAnchor="end"
          height={50}
        />
        <YAxis
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v: number) => formatThousands(v)}
        />
        <ChartTooltip
          cursor={{ fill: "rgba(127,127,127,0.06)" }}
          content={<CustomTooltip />}
        />
        {Array.from(Array(numRegions).keys()).map((n) => (
          <Bar
            key={`bar_${n}`}
            dataKey={`preferences.${n}.preferences`}
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
          >
            {chartData?.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.color}
                fillOpacity={n === 0 ? 1 : 0.55}
              />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  );
};
