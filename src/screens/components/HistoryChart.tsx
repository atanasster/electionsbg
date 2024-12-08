import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ElectionInfo, PartyInfo } from "@/data/dataTypes";
import { formatThousands, localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";

const CustomTooltip: FC<{
  active?: boolean;
  payload?: {
    value: number;
    payload: { date: string; votes: number };
  }[];
  label?: string;
}> = ({ active, payload }) => {
  const { t } = useTranslation();

  return active && payload?.[0] ? (
    <div className="z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
      <div className="flex flex-col items-start">
        <div className="text-muted">{`${payload[0].payload.date}`}</div>
        <div className="flex">
          <div className="ml-2 font-semibold">
            {`${formatThousands(payload[0].value)}`}
          </div>
          <div className="text-muted ml-1 lowercase ">{t("votes")}</div>
        </div>
      </div>
    </div>
  ) : null;
};
export const HistoryChart: FC<{
  party: PartyInfo;
  stats: ElectionInfo[];
  xAxis?: boolean;
  cursorPointer?: boolean;
  animationDuration?: number;
  className?: string;
}> = ({
  party,
  stats,
  xAxis,
  className,
  cursorPointer,
  animationDuration = 1000,
}) => {
  const { selected } = useElectionContext();
  const { t } = useTranslation();
  const chartData = useMemo(() => {
    return stats
      .map((e) => ({
        date: localDate(e.name),
        name: e.name,
        votes: e.results?.votes.find((v) => v.nickName === party.nickName)
          ?.totalVotes,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [party.nickName, stats]);
  return (
    <ChartContainer config={{}} className={className}>
      <AreaChart
        accessibilityLayer
        data={chartData}
        className={cursorPointer ? "!cursor-pointer" : undefined}
      >
        <ChartTooltip cursor={true} content={<CustomTooltip />} />
        {xAxis && (
          <>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              tickMargin={10}
              axisLine={true}
              //tickFormatter={(value) => value.slice(0, 3)}
            />
            <YAxis />
            <ReferenceLine
              x={localDate(selected)}
              stroke="red"
              label={t("selected_elections")}
            />
          </>
        )}
        <Area
          animationDuration={animationDuration}
          dataKey="votes"
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
