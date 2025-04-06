import { Area, AreaChart, XAxis } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ElectionInfo, PartyInfo } from "@/data/dataTypes";
import { findPrevVotes, formatThousands, localDate } from "@/data/utils";

const CustomTooltip: FC<{
  active?: boolean;
  payload?: {
    value: number;
    payload: {
      date: string;
      votes: number;
      name: string;
      total?: number;
      party: string;
    };
  }[];
  label?: string;
}> = ({ active, payload }) => {
  const { t } = useTranslation();
  return active && payload?.[0] ? (
    <div className="z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
      <div className="flex flex-col items-start gap-2">
        <div className="text-muted">{`${payload[0].payload.date}`}</div>
        {payload[0].payload.total && (
          <div className="flex gap-2">
            <div>
              {t("total")}
              {": "}
            </div>
            <div className="font-semibold">
              {formatThousands(payload[0].payload.total)}
            </div>
            <div className="text-muted lowercase ">{t("votes")}</div>
          </div>
        )}
        <div className="flex gap-2">
          <div>
            {payload[0].payload.party}
            {": "}
          </div>
          <div className="font-semibold">
            {formatThousands(payload[0].payload.votes)}
          </div>
          <div className="text-muted lowercase ">{t("votes")}</div>
        </div>
      </div>
    </div>
  ) : null;
};
export const HistoryChart: FC<{
  party: PartyInfo;
  isConsolidated?: boolean;
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
  isConsolidated,
  animationDuration = 1000,
}) => {
  const chartData = useMemo(() => {
    return stats
      .map((e) => {
        const { nickName, prevTotalVotes } = findPrevVotes(
          party,
          e.results?.votes,
          isConsolidated,
        );
        return {
          date: localDate(e.name),
          name: e.name,
          party: nickName || party.nickName,
          total: e.results?.protocol?.totalActualVoters,
          votes: prevTotalVotes,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [isConsolidated, party, stats]);
  return (
    <ChartContainer config={{}} className={className}>
      <AreaChart
        accessibilityLayer
        data={chartData}
        className={cursorPointer ? "!cursor-pointer" : undefined}
      >
        <ChartTooltip cursor={true} content={<CustomTooltip />} />
        {xAxis && (
          <XAxis
            dataKey="date"
            tickLine={false}
            tickMargin={10}
            axisLine={true}
            //tickFormatter={(value) => value.slice(0, 3)}
          />
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
