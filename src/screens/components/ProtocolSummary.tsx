import { FC } from "react";
import { Newspaper, LaptopMinimal, Users, Flag } from "lucide-react";
import { Bar, BarChart, Cell, CartesianGrid, XAxis } from "recharts";
import { SectionProtocol, Votes } from "@/data/dataTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/ux/Tooltip";
import { formatPct, numberWithCommas } from "@/data/utils";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { useElectionInfo } from "@/data/ElectionsContext";

const CustomTooltip: FC<{
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}> = ({ active, payload, label }) => {
  const { t } = useTranslation();
  return active && payload ? (
    <div className="z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2">
      <div className="flex">
        <div className="text-muted">{`${label}:`}</div>
        <div className="ml-2 font-semibold">
          {numberWithCommas(payload[0].value)}
        </div>
        <div className="text-muted ml-1 lowercase ">{t("votes")}</div>
      </div>
    </div>
  ) : null;
};

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
                <div className="text-4xl my-4 mr-2 font-bold">
                  {numberWithCommas(protocol.totalActualVoters)}
                </div>
              </Tooltip>
              <Tooltip text={t("pct_total_voters_explainer")}>
                <div className="text-2xl my-4 font-semibold">
                  {`(${formatPct(
                    100 *
                      (protocol.totalActualVoters /
                        protocol.numRegisteredVoters),
                    1,
                  )})`}
                </div>
              </Tooltip>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground leading-6">
              <Tooltip text={t("num_registered_voters_explainer")}>
                <div>{`${t("registered_voters")}: `}</div>
              </Tooltip>
              <Tooltip text={t("num_registered_voters_explainer")}>
                <div className="font-bold text-primary">
                  {numberWithCommas(protocol.numRegisteredVoters)}
                </div>
              </Tooltip>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <Tooltip text={t("num_additional_voters_explainer")}>
                <div>{`${t("additional_voters")}: `}</div>
              </Tooltip>
              <div className="flex">
                <Tooltip text={t("num_additional_voters_explainer")}>
                  <span className="font-bold text-primary">
                    {numberWithCommas(protocol.numAdditionalVoters)}
                  </span>
                </Tooltip>
                <Tooltip text={t("pct_additional_voters_explainer")}>
                  <div className="font-bold text-primary ml-2">
                    {`(${formatPct(
                      100 *
                        (protocol.numAdditionalVoters /
                          protocol.totalActualVoters),
                      2,
                    )})`}
                  </div>
                </Tooltip>
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground leading-6">
              <Tooltip text={t("num_invalid_ballots_explainer")}>
                <div>{`${t("invalid_ballots")}: `}</div>
              </Tooltip>
              <div className="flex">
                <Tooltip text={t("num_invalid_ballots_explainer")}>
                  <div className="font-bold text-primary">
                    {numberWithCommas(protocol.numInvalidBallotsFound)}
                  </div>
                </Tooltip>
                <Tooltip text={t("pct_invalid_ballots_to_all_votes_explainer")}>
                  <div className="font-bold text-primary ml-2">
                    {`(${formatPct(
                      100 *
                        (protocol.numInvalidBallotsFound /
                          protocol.totalActualVoters),
                      2,
                    )})`}
                  </div>
                </Tooltip>
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <Tooltip text={t("num_supports_no_one_explainer")}>
                <div>{`${t("support_no_one")}: `}</div>
              </Tooltip>
              <div className="flex">
                <Tooltip text={t("num_supports_no_one_explainer")}>
                  <div className="font-bold text-primary">
                    {numberWithCommas(
                      protocol.numValidNoOnePaperVotes +
                        (protocol.numValidNoOneMachineVotes || 0),
                    )}
                  </div>
                </Tooltip>
                <Tooltip text={t("pct_supports_no_one_explainer")}>
                  <div className="font-bold text-primary ml-2">
                    {`(${formatPct(
                      100 *
                        ((protocol.numValidNoOnePaperVotes +
                          (protocol.numValidNoOneMachineVotes || 0)) /
                          protocol.totalActualVoters),
                      2,
                    )})`}
                  </div>
                </Tooltip>
              </div>
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
            <div className="flex">
              <Tooltip text={t("valid_paper_votes_explainer")}>
                <div className="text-4xl my-4 font-bold justify-self-start">
                  {numberWithCommas(protocol.numValidVotes)}
                </div>
              </Tooltip>
              <Tooltip text={t("pct_paper_votes_explainer")}>
                <div className="text-2xl my-4 font-semibold ml-2">
                  {`(${formatPct(
                    100 *
                      (protocol.numValidVotes /
                        (protocol.numValidVotes +
                          (protocol.numValidMachineVotes || 0))),
                    1,
                  )})`}
                </div>
              </Tooltip>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground leading-6">
              <Tooltip text={t("num_paper_ballots_found_explainer")}>
                <div>{`${t("paper_ballots_found")}: `}</div>
              </Tooltip>
              <div className="flex">
                <Tooltip text={t("num_paper_ballots_found_explainer")}>
                  <div className="font-bold text-primary">
                    {numberWithCommas(protocol.numPaperBallotsFound)}
                  </div>
                </Tooltip>
                <Tooltip text={t("pct_valid_paper_ballots")}>
                  <div className="font-bold text-primary ml-2">
                    {`(${formatPct(
                      100 *
                        (protocol.numValidVotes /
                          protocol.numPaperBallotsFound),
                      2,
                    )})`}
                  </div>
                </Tooltip>
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <Tooltip text={t("num_invalid_paper_ballots")}>
                <div>{`${t("invalid_ballots")}: `}</div>
              </Tooltip>
              <div className="flex">
                <Tooltip text={t("num_invalid_paper_ballots")}>
                  <div className="font-bold text-primary">
                    {numberWithCommas(protocol.numInvalidBallotsFound)}
                  </div>
                </Tooltip>
                <Tooltip text={t("pct_invalid_paper_ballots")}>
                  <div className="font-bold text-primary ml-2">
                    {`(${formatPct(
                      100 *
                        (protocol.numInvalidBallotsFound /
                          protocol.numPaperBallotsFound),
                      2,
                    )})`}
                  </div>
                </Tooltip>
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground leading-6">
              <Tooltip text={t("num_supports_no_one_explainer")}>
                <div>{`${t("support_no_one")}: `}</div>
              </Tooltip>
              <div className="flex">
                <Tooltip text={t("num_supports_no_one_explainer")}>
                  <div className="font-bold text-primary">
                    {numberWithCommas(protocol.numValidNoOnePaperVotes)}
                  </div>
                </Tooltip>
                <Tooltip text={t("pct_supports_noone_paper_ballots")}>
                  <div className="font-bold text-primary ml-2">
                    {`(${formatPct(
                      100 *
                        (protocol.numValidNoOnePaperVotes /
                          protocol.numPaperBallotsFound),
                      2,
                    )})`}
                  </div>
                </Tooltip>
              </div>
            </div>
          </CardContent>
        </Card>
        {!!protocol.numValidMachineVotes && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-md font-medium">
                {t("machine_votes")}
              </CardTitle>
              <LaptopMinimal />
            </CardHeader>
            <CardContent>
              <div className="flex">
                <Tooltip text={t("total_machine_votes_explainer")}>
                  <div className="text-4xl my-4 font-bold justify-self-start">
                    {numberWithCommas(protocol.numValidMachineVotes)}
                  </div>
                </Tooltip>
                <Tooltip text={t("pct_machine_votes_explainer")}>
                  <div className="text-2xl my-4 font-semibold ml-2">
                    {`(${formatPct(
                      100 *
                        (protocol.numValidMachineVotes /
                          (protocol.numValidVotes +
                            (protocol.numValidMachineVotes || 0))),
                      1,
                    )})`}
                  </div>
                </Tooltip>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground leading-6">
                <Tooltip text={t("num_machine_ballots_found_explainer")}>
                  <div>{`${t("machine_ballots_found")}: `}</div>
                </Tooltip>
                <Tooltip text={t("num_machine_ballots_found_explainer")}>
                  <div className="font-bold text-primary">
                    {numberWithCommas(protocol?.numMachineBallots)}
                  </div>
                </Tooltip>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <Tooltip text={t("num_machine_supports_no_one_explainer")}>
                  <div>{`${t("support_no_one")}: `}</div>
                </Tooltip>
                <div className="flex">
                  <Tooltip text={t("num_machine_supports_no_one_explainer")}>
                    <div className="font-bold text-primary">
                      {numberWithCommas(protocol?.numValidNoOneMachineVotes)}
                    </div>
                  </Tooltip>
                  <Tooltip text={t("pct_supports_noone_machine_ballots")}>
                    <div className="font-bold text-primary ml-2">
                      {`(${
                        protocol.numValidNoOneMachineVotes
                          ? formatPct(
                              100 *
                                (protocol.numValidNoOneMachineVotes /
                                  protocol.numValidMachineVotes),
                              2,
                            )
                          : ""
                      })`}
                    </div>
                  </Tooltip>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("top_parties")}
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
                  formatter={(value, name) => (
                    <div className="flex min-w-[130px] items-center text-md">
                      {chartConfig[name as keyof typeof chartConfig]?.label ||
                        name}
                      <div className="ml-auto flex items-baseline gap-0.5 font-mono font-medium tabular-nums">
                        {value}
                      </div>
                    </div>
                  )}
                  content={<CustomTooltip />}
                />
                <Bar dataKey="totalVotes" radius={8}>
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
