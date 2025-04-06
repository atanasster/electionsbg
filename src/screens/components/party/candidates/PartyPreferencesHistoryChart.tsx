import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PartyInfo } from "@/data/dataTypes";
import { formatThousands, localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { usePreferencesStats } from "./data/usePreferencesStats";

const CustomTooltip: FC<{
  active?: boolean;
  payload?: {
    value: number;
    payload: {
      date: string;
      totalVotes: number;
    };
  }[];
  label?: string;
}> = ({ active, payload }) => {
  const { t } = useTranslation();
  return active && payload?.[0] ? (
    <div className="z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
      <div className="flex flex-col items-start gap-2">
        <div className="text-muted">{`${payload[0].payload.date}`}</div>
        {payload[0].payload.totalVotes && (
          <div className="flex gap-2">
            <div className="font-semibold">
              {formatThousands(payload[0].payload.totalVotes)}
            </div>
            <div className="text-muted lowercase ">{t("preferences")}</div>
          </div>
        )}
      </div>
    </div>
  ) : null;
};
export const PartyPreferencesHistoryChart: FC<{
  party: PartyInfo;
}> = ({ party }) => {
  const { selected } = useElectionContext();
  const stats = usePreferencesStats(party);

  const chartData = useMemo(() => {
    return stats
      ? [
          { date: localDate(selected), name: selected, ...stats },
          ...Object.keys(stats.history).map((e) => {
            return {
              date: localDate(e),
              name: e,
              ...stats.history[e],
            };
          }),
        ].sort((a, b) => a.name.localeCompare(b.name))
      : undefined;
  }, [selected, stats]);
  return (
    <ChartContainer config={{}} className="py-2">
      <AreaChart accessibilityLayer data={chartData}>
        <ChartTooltip cursor={true} content={<CustomTooltip />} />
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={true} />
        <YAxis />
        <Area
          dataKey="totalVotes"
          type="linear"
          style={{ cursor: "pointer" }}
          stroke="red"
          fill="transparent"
          strokeWidth={4}
          fillOpacity={0.3}
          dot={false}
        />

        <Area
          dataKey="totalVotes"
          type="linear"
          style={{ cursor: "pointer" }}
          stroke={party.color}
          fill={party.color}
          strokeWidth={4}
          fillOpacity={0.3}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
};
