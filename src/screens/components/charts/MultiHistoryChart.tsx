import {
  Line,
  LineChart,
  CartesianGrid,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartLegend,
} from "@/components/ui/chart";
import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ElectionInfo } from "@/data/dataTypes";
import { findPrevVotes, formatThousands, localDate } from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { cn } from "@/lib/utils";
import { Caption } from "@/ux/Caption";
import { useConsolidatedLabel } from "../useConsolidatedLabel";
import { Hint } from "@/ux/Hint";
import { HintedSwitch } from "@/ux/HintedSwitch";

const CustomTooltip: FC<{
  active?: boolean;
  payload?: {
    date: string;
    color: string;
    value: number;
    name: string;
    payload: { date: string; votes: number; total?: number };
  }[];
  label?: string;
}> = ({ active, payload }) => {
  return active && payload?.[0] ? (
    <div className="z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
      <div className="text-muted text-sm text-center w-full pb-2">{`${payload[0].payload.date}`}</div>
      <div className="flex flex-col items-start gap-0.5">
        {payload
          .sort((a, b) => b.value - a.value)
          .map((p) => (
            <div className="flex gap-1 w-full justify-between" key={p.name}>
              <div
                className="text-white w-16 truncate px-1"
                style={{
                  backgroundColor: p.color,
                }}
              >
                {p.name}
              </div>
              <div className="font-semibold text-right ">
                {`${formatThousands(p.value)}`}
              </div>
            </div>
          ))}
      </div>
    </div>
  ) : null;
};

const CustomLegend: FC<{ payload?: { dataKey: string; color: string }[] }> = ({
  payload,
}) => {
  const { findByNickName } = usePartyInfo();
  return (
    payload && (
      <div className="flex flex-wrap gap-1 p-2 mt-2">
        {payload.map((p) => {
          const name = findByNickName(p.dataKey);
          return (
            name && (
              <Hint key={p.dataKey} text={name.nickName}>
                <div
                  className="w-16 truncate text-white font-semibold px-1"
                  style={{
                    backgroundColor: p.color,
                  }}
                >
                  {p.dataKey}
                </div>
              </Hint>
            )
          );
        })}
      </div>
    )
  );
};
export const MultiHistoryChart: FC<{
  stats: ElectionInfo[];
  className?: string;
}> = ({ stats, className }) => {
  const { isConsolidated, consolidated } = useConsolidatedLabel();
  const [showAllVoters, setShowAllVoters] = useState(false);
  const { selected } = useElectionContext();
  const { parties } = usePartyInfo();
  const { t } = useTranslation();
  const chartData = useMemo(() => {
    return stats
      .map((e) => {
        return parties?.reduce(
          (acc, party) => {
            const { prevTotalVotes } = findPrevVotes(
              party,
              e.results?.votes,
              isConsolidated,
            );
            if (prevTotalVotes) {
              return {
                ...acc,
                [party.nickName]: prevTotalVotes,
              };
            }
            return acc;
          },
          {
            date: e.name,
            [t("total")]: e.results?.protocol?.totalActualVoters,
          },
        );
      })
      .filter((a) => !!a)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((a) => ({
        ...a,
        date: localDate(a.date),
      }));
  }, [isConsolidated, parties, stats, t]);
  return (
    <>
      <Caption>{t("historical_chart")}</Caption>
      <div className="flex justify-between w-full">
        <HintedSwitch
          hint={t("show_total_votes_explainer")}
          label={t("show_total_votes")}
          value={showAllVoters}
          setValue={setShowAllVoters}
        />
        {consolidated}
      </div>
      <ChartContainer
        config={{}}
        className={cn("w-full md:w-4/5 lg:w-3/4 min-h-[350px]", className)}
      >
        <LineChart accessibilityLayer data={chartData}>
          <ChartTooltip cursor={true} content={<CustomTooltip />} />
          <ChartLegend
            content={<CustomLegend />}
            align="left"
            verticalAlign="bottom"
          />
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            tickMargin={10}
            axisLine={true}
          />
          <YAxis />
          <ReferenceLine
            x={localDate(selected)}
            stroke="red"
            label={t("selected_elections")}
          />
          {showAllVoters && (
            <Line
              dataKey={t("total")}
              type="monotone"
              stroke="red"
              strokeWidth={3}
              dot={false}
            />
          )}
          {parties?.map((party) => (
            <Line
              key={party.nickName}
              dataKey={party.nickName}
              type="monotone"
              stroke={party.color}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </>
  );
};
