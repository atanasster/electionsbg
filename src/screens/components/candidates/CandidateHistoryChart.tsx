import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis } from "recharts";
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
    <div className="z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
      <div className="flex flex-col items-start gap-1">
        <div className="text-muted">{`${payload[0].payload.date} - ${payload[0].payload.party}`}</div>
        {payload[0].payload.preferences
          .sort((a, b) => (b.preferences || 0) - (a.preferences || 0))
          .map((p, index) => {
            return (
              <div key={`region_${index}`} className="flex gap-1">
                <div>
                  {p.region_name}
                  {": "}
                </div>
                <div className="font-semibold">
                  {formatThousands(p.preferences)}
                </div>
                <div className="text-muted lowercase ">{t("pref.")}</div>
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
    <ChartContainer config={{}}>
      <BarChart accessibilityLayer data={chartData} barGap={0}>
        <defs>
          <filter id="colored-bg" x="-5%" width="110%" y="0%" height="100%">
            <feFlood floodColor="rgba(0,0,0,0.5)" />
            <feComposite operator="over" in="SourceGraphic"></feComposite>
          </filter>
        </defs>
        <ChartTooltip cursor={true} content={<CustomTooltip />} />
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} tickMargin={0} axisLine={true} />
        {Array.from(Array(numRegions).keys()).map((n) => (
          <Bar key={`bar_${n}`} dataKey={`preferences.${n}.preferences`}>
            {chartData?.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
            <LabelList
              filter={"url(#colored-bg)"}
              position="insideEnd"
              className="fill-white"
              dataKey={`preferences.${n}.region_name`}
              fontSize={10}
              fontWeight={900}
              angle={270}
              formatter={(p: string) => {
                return p;
              }}
            />
          </Bar>
        ))}
      </BarChart>
    </ChartContainer>
  );
};
