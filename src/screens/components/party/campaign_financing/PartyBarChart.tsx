import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PartyFiling, PartyInfo } from "@/data/dataTypes";
import {
  campaignCostFiling,
  findPrevVotes,
  formatThousands,
  localDate,
} from "@/data/utils";
import { useElectionContext } from "@/data/ElectionContext";

const CustomTooltip: FC<{
  active?: boolean;
  payload?: {
    value: number;
    payload: {
      date: string;
      votes: number;
      name: string;
      totalFinancing?: number;
      party: string;
    };
  }[];
  label?: string;
}> = ({ active, payload }) => {
  const { t } = useTranslation();
  return active && payload?.[0] ? (
    <div className="z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
      <div className="flex flex-col items-start gap-1">
        <div className="text-muted">{`${payload[0].payload.date}`}</div>
        {payload[0].payload.totalFinancing && (
          <div className="flex gap-1">
            <div>
              {t("financing")}
              {": "}
            </div>
            <div className="font-semibold">
              {formatThousands(payload[0].payload.totalFinancing)}
            </div>
            <div className="text-muted">{`${t("lv")}.`}</div>
          </div>
        )}
        <div className="flex gap-1">
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
export const PartyBarChart: FC<{
  party: PartyInfo;
  className?: string;
  filing?: PartyFiling;
  priorFiling?: PartyFiling;
}> = ({ party, className, filing, priorFiling }) => {
  const { stats, selected, priorElections } = useElectionContext();
  const chartData = useMemo(() => {
    return stats
      .map((e) => {
        const { nickName, prevTotalVotes } = findPrevVotes(
          party,
          e.results?.votes,
          true,
        );
        return {
          date: localDate(e.name),
          name: e.name,
          totalFinancing:
            e.name === selected
              ? campaignCostFiling(filing)
              : e.name === priorElections?.name
                ? campaignCostFiling(priorFiling)
                : undefined,
          party: nickName || party.nickName,
          total: e.results?.protocol?.totalActualVoters,
          votes: prevTotalVotes,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [filing, party, priorElections, priorFiling, selected, stats]);
  return (
    <ChartContainer config={{}} className={className}>
      <BarChart accessibilityLayer data={chartData} barGap={0}>
        <ChartTooltip cursor={true} content={<CustomTooltip />} />
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          tickMargin={10}
          axisLine={true}
        />
        {(filing || priorFiling) && (
          <YAxis dataKey="totalFinancing" visibility="hidden" />
        )}
        <YAxis dataKey="votes" visibility="hidden" />

        <Bar dataKey="totalFinancing" fill="fuchsia" />
        <Bar dataKey="votes" stroke={party.color} fill={party.color} />
      </BarChart>
    </ChartContainer>
  );
};
