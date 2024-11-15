import { FC } from "react";
import { Newspaper, LaptopMinimal, Users, Flag } from "lucide-react";
import { Bar, BarChart, Cell, CartesianGrid, XAxis } from "recharts";
import { SectionProtocol, Votes } from "@/data/dataTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/ux/Tooltip";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useElectionInfo } from "@/data/ElectionsContext";

const numberWithCommas = (x?: number) =>
  x !== undefined ? x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "";

export const ProtocolSummary: FC<{
  protocol: SectionProtocol;
  votes?: Votes[];
}> = ({ protocol, votes }) => {
  const { t } = useTranslation();
  const { findParty } = useElectionInfo();
  const chartConfig = {
    totalVotes: {
      label: `${t("total_votes")}: `,
    },
  } satisfies ChartConfig;

  const topParties = votes
    ?.sort((a, b) => b.totalVotes - a.totalVotes)
    .slice(0, 5)
    .filter((v) => v.totalVotes > 0)
    .map((v, idx) => {
      const party = findParty(v.key);
      return {
        num: idx,
        ...v,
        nickName: party?.nickName,
        color: party?.color,
      };
    });

  return (
    <div className="w-full items-center">
      <div
        className={`grid gap-4 sm:grid-cols-2 ${protocol.numValidMachineVotes ? "lg:grid-cols-4" : "lg:grid-cols-3"} my-4`}
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-md font-medium">{t("voters")}</CardTitle>
            <Users />
          </CardHeader>
          <CardContent>
            <div className="flex">
              <Tooltip text={t("total_voters_explainer")}>
                <div className="text-4xl my-4 font-bold">
                  {numberWithCommas(protocol.totalActualVoters)}
                </div>
              </Tooltip>
              <Tooltip text={t("total_voters_explainer")}>
                <div className="text-4xl my-4 font-bold">
                  {numberWithCommas(protocol.totalActualVoters)}
                </div>
              </Tooltip>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <div>{`${t("registered_voters")}: `}</div>
              <div className="font-bold text-primary">
                {numberWithCommas(protocol.numRegisteredVoters)}
              </div>
              <div className="font-bold text-primary">(5%)</div>
            </div>
            <div className="text-xs text-muted-foreground">
              {`${t("additional_voters")}: `}
              <span className="font-bold text-primary">
                {numberWithCommas(protocol.numAdditionalVoters)}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-md font-medium">
              {t("paper_votes")}
            </CardTitle>
            <Newspaper />
          </CardHeader>
          <CardContent>
            <Tooltip text={t("valid_votes_explainer")}>
              <div className="text-4xl my-4 font-bold justify-self-start">
                {numberWithCommas(protocol.numValidVotes)}
              </div>
            </Tooltip>
            <div className="text-xs text-muted-foreground">
              {`${t("paper_ballots_found")}: `}
              <span className="font-bold text-primary">
                {numberWithCommas(protocol.numPaperBallotsFound)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {`${t("invalid_ballots")}: `}
              <span className="font-bold text-primary">
                {numberWithCommas(protocol.numInvalidBallotsFound)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {`${t("support_no_one")}: `}
              <span className="font-bold text-primary">
                {numberWithCommas(protocol?.numValidNoOnePaperVotes)}
              </span>
            </div>
          </CardContent>
        </Card>
        {protocol.numValidMachineVotes && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-md font-medium">
                {t("machine_votes")}
              </CardTitle>
              <LaptopMinimal />
            </CardHeader>
            <CardContent>
              <Tooltip text={t("total_machine_votes_explainer")}>
                <div className="text-4xl my-4 font-bold justify-self-start">
                  {numberWithCommas(protocol.numValidMachineVotes)}
                </div>
              </Tooltip>
              <div className="text-xs text-muted-foreground">
                {`${t("machine_ballots_found")}: `}
                <span className="font-bold text-primary">
                  {numberWithCommas(protocol?.numMachineBallots)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {`${t("support_no_one")}: `}
                <span className="font-bold text-primary">
                  {numberWithCommas(protocol?.numValidNoOneMachineVotes)}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("parties")}
            </CardTitle>
            <Flag />
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig}>
              <BarChart accessibilityLayer data={topParties}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="nickName"
                  tickMargin={10}
                  tickFormatter={(value: string) => {
                    if (value.length > 6) {
                      const parts = value.split("-");
                      if (parts.length > 1) {
                        return parts[0];
                      }
                    }

                    return value.slice(0, 6);
                  }}
                  interval={0}
                />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent indicator="dashed" />}
                />
                <Bar dataKey="totalVotes" fill="var(--color-accent)" radius={8}>
                  {topParties?.map((p) => (
                    <Cell key={`cell-${p.key}`} fill={p.color} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
