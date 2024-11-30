import { FC, useMemo } from "react";
import { Newspaper, LaptopMinimal, Users, Flag } from "lucide-react";
import { Bar, BarChart, Cell, CartesianGrid, XAxis } from "recharts";
import { SectionProtocol, Votes } from "@/data/dataTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useTranslation } from "react-i18next";
import { Hint } from "@/ux/Hint";
import { formatPct, formatThousands } from "@/data/utils";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { usePartyInfo } from "@/data/usePartyInfo";
import { useElectionContext } from "@/data/ElectionContext";

const CustomTooltip: FC<{
  active?: boolean;
  payload?: {
    value: number;
    payload: { pctVotes: number; nickName: string };
  }[];
  label?: string;
}> = ({ active, payload }) => {
  const { t } = useTranslation();
  return active && payload ? (
    <div className="z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2">
      <div className="flex">
        <div className="text-muted">{`${payload[0].payload.nickName}:`}</div>
        <div className="ml-2 font-semibold">
          {`${formatThousands(payload[0].value)} ${payload[0].payload.pctVotes ? `(${formatPct(payload[0].payload.pctVotes, 2)}` : ""})`}
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
  const { findParty } = usePartyInfo();
  const { isMachineOnly } = useElectionContext();
  const chartConfig = {
    totalVotes: {
      label: `${t("total_votes")}: `,
    },
  } satisfies ChartConfig;
  const topParties = useMemo(() => {
    const totalVotes = votes?.reduce((acc, v) => acc + v.totalVotes, 0);
    return votes
      ?.sort((a, b) => b.totalVotes - a.totalVotes)
      .filter((v, idx) => {
        const pctVotes = totalVotes ? (100 * v?.totalVotes) / totalVotes : 0;
        return pctVotes >= 4 || (idx < 5 && v.totalVotes > 0);
      })
      .map((v) => {
        const party = findParty(v.partyNum);
        const pctVotes = totalVotes ? (100 * v?.totalVotes) / totalVotes : 0;
        return {
          ...v,
          nickName: party?.nickName,
          color: party?.color,
          pctVotes,
        };
      });
  }, [findParty, votes]);
  return (
    <div className="w-full items-center">
      <div
        className={`grid gap-4 sm:grid-cols-2 ${protocol.numValidMachineVotes && protocol.numValidVotes ? "lg:grid-cols-4" : "lg:grid-cols-3"} my-4`}
      >
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-md font-medium">{t("voters")}</CardTitle>
            <Users />
          </CardHeader>
          <CardContent>
            <div className="flex">
              <Hint text={t("total_voters_explainer")}>
                <div className="text-2xl xl:text-4xl my-4 mr-2 font-bold">
                  {formatThousands(protocol.totalActualVoters)}
                </div>
              </Hint>
              {!!protocol.numRegisteredVoters && (
                <Hint text={t("pct_total_voters_explainer")}>
                  <div className="text-xl xl:text-lg my-4 font-semibold">
                    {`(${formatPct(
                      100 *
                        (protocol.totalActualVoters /
                          protocol.numRegisteredVoters),
                      1,
                    )})`}
                  </div>
                </Hint>
              )}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground leading-6">
              <Hint text={t("num_registered_voters_explainer")}>
                <div>{`${t("registered_voters")}: `}</div>
              </Hint>
              <Hint text={t("num_registered_voters_explainer")}>
                <div className="font-bold text-primary">
                  {formatThousands(protocol.numRegisteredVoters)}
                </div>
              </Hint>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <Hint text={t("num_additional_voters_explainer")}>
                <div>{`${t("additional_voters")}: `}</div>
              </Hint>
              <div className="flex">
                <Hint text={t("num_additional_voters_explainer")}>
                  <span className="font-bold text-primary">
                    {formatThousands(protocol.numAdditionalVoters)}
                  </span>
                </Hint>
                <Hint text={t("pct_additional_voters_explainer")}>
                  <div className="font-bold text-primary ml-2">
                    {`(${formatPct(
                      100 *
                        ((protocol.numAdditionalVoters || 0) /
                          protocol.totalActualVoters),
                      2,
                    )})`}
                  </div>
                </Hint>
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground leading-6">
              <Hint text={t("num_invalid_ballots_explainer")}>
                <div>{`${t("invalid_ballots")}: `}</div>
              </Hint>
              <div className="flex">
                <Hint text={t("num_invalid_ballots_explainer")}>
                  <div className="font-bold text-primary">
                    {formatThousands(protocol.numInvalidBallotsFound)}
                  </div>
                </Hint>
                <Hint text={t("pct_invalid_ballots_to_all_votes_explainer")}>
                  <div className="font-bold text-primary ml-2">
                    {`(${formatPct(
                      100 *
                        ((protocol.numInvalidBallotsFound || 0) /
                          protocol.totalActualVoters),
                    )})`}
                  </div>
                </Hint>
              </div>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <Hint text={t("num_supports_no_one_explainer")}>
                <div>{`${t("support_no_one")}: `}</div>
              </Hint>
              <div className="flex">
                <Hint text={t("num_supports_no_one_explainer")}>
                  <div className="font-bold text-primary">
                    {formatThousands(
                      (protocol.numValidNoOnePaperVotes || 0) +
                        (protocol.numValidNoOneMachineVotes || 0),
                    )}
                  </div>
                </Hint>
                <Hint text={t("pct_supports_no_one_explainer")}>
                  <div className="font-bold text-primary ml-2">
                    {`(${formatPct(
                      100 *
                        (((protocol.numValidNoOnePaperVotes || 0) +
                          (protocol.numValidNoOneMachineVotes || 0)) /
                          protocol.totalActualVoters),
                      2,
                    )})`}
                  </div>
                </Hint>
              </div>
            </div>
          </CardContent>
        </Card>
        {!!protocol.numValidVotes && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-md font-medium">
                {t("paper_votes")}
              </CardTitle>
              <Newspaper />
            </CardHeader>

            <CardContent>
              <div className="flex">
                <Hint text={t("valid_paper_votes_explainer")}>
                  <div className="text-2xl xl:text-4xl my-4 font-bold justify-self-start">
                    {formatThousands(protocol.numValidVotes)}
                  </div>
                </Hint>
                <Hint text={t("pct_paper_votes_explainer")}>
                  <div className="text-xl xl:text-2xl my-4 font-semibold ml-2">
                    {`(${formatPct(
                      100 *
                        (protocol.numValidVotes /
                          (protocol.numValidVotes +
                            (protocol.numValidMachineVotes || 0))),
                      1,
                    )})`}
                  </div>
                </Hint>
              </div>
              {!!protocol.numPaperBallotsFound && (
                <div className="flex justify-between text-xs text-muted-foreground leading-6">
                  <Hint text={t("num_paper_ballots_found_explainer")}>
                    <div>{`${t("paper_ballots_found")}: `}</div>
                  </Hint>
                  <div className="flex">
                    <Hint text={t("num_paper_ballots_found_explainer")}>
                      <div className="font-bold text-primary">
                        {formatThousands(protocol.numPaperBallotsFound)}
                      </div>
                    </Hint>
                    <Hint text={t("pct_valid_paper_ballots")}>
                      <div className="font-bold text-primary ml-2">
                        {`(${formatPct(
                          100 *
                            (protocol.numValidVotes /
                              protocol.numPaperBallotsFound),
                          2,
                        )})`}
                      </div>
                    </Hint>
                  </div>
                </div>
              )}
              {!!protocol.numPaperBallotsFound &&
                !!protocol.numInvalidBallotsFound && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <Hint text={t("num_invalid_paper_ballots")}>
                      <div>{`${t("invalid_ballots")}: `}</div>
                    </Hint>
                    <div className="flex">
                      <Hint text={t("num_invalid_paper_ballots")}>
                        <div className="font-bold text-primary">
                          {formatThousands(protocol.numInvalidBallotsFound)}
                        </div>
                      </Hint>
                      <Hint text={t("pct_invalid_paper_ballots")}>
                        <div className="font-bold text-primary ml-2">
                          {`(${formatPct(
                            100 *
                              (protocol.numInvalidBallotsFound /
                                protocol.numPaperBallotsFound),
                            2,
                          )})`}
                        </div>
                      </Hint>
                    </div>
                  </div>
                )}
              {!!protocol.numValidNoOnePaperVotes &&
                !!protocol.numPaperBallotsFound && (
                  <div className="flex justify-between text-xs text-muted-foreground leading-6">
                    <Hint text={t("num_supports_no_one_explainer")}>
                      <div>{`${t("support_no_one")}: `}</div>
                    </Hint>
                    <div className="flex">
                      <Hint text={t("num_supports_no_one_explainer")}>
                        <div className="font-bold text-primary">
                          {formatThousands(protocol.numValidNoOnePaperVotes)}
                        </div>
                      </Hint>
                      <Hint text={t("pct_supports_noone_paper_ballots")}>
                        <div className="font-bold text-primary ml-2">
                          {`(${formatPct(
                            100 *
                              (protocol.numValidNoOnePaperVotes /
                                protocol.numPaperBallotsFound),
                            2,
                          )})`}
                        </div>
                      </Hint>
                    </div>
                  </div>
                )}
            </CardContent>
          </Card>
        )}
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
                <Hint text={t("total_machine_votes_explainer")}>
                  <div className="text-2xl xl:text-4xl my-4 font-bold justify-self-start">
                    {formatThousands(protocol.numValidMachineVotes)}
                  </div>
                </Hint>
                {(protocol.numValidVotes || protocol.numValidMachineVotes) && (
                  <Hint text={t("pct_machine_votes_explainer")}>
                    <div className="text-xl xl:text-2xl my-4 font-semibold ml-2">
                      {`(${formatPct(
                        100 *
                          (protocol.numValidMachineVotes /
                            ((protocol.numValidVotes || 0) +
                              (protocol.numValidMachineVotes || 0))),
                        1,
                      )})`}
                    </div>
                  </Hint>
                )}
              </div>{" "}
              <div className="flex justify-between text-xs text-muted-foreground leading-6">
                <Hint text={t("num_machine_ballots_found_explainer")}>
                  <div>{`${t("machine_ballots_found")}: `}</div>
                </Hint>
                <Hint text={t("num_machine_ballots_found_explainer")}>
                  <div className="font-bold text-primary">
                    {formatThousands(protocol?.numMachineBallots)}
                  </div>
                </Hint>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <Hint text={t("num_machine_supports_no_one_explainer")}>
                  <div>{`${t("support_no_one")}: `}</div>
                </Hint>
                <div className="flex">
                  <Hint text={t("num_machine_supports_no_one_explainer")}>
                    <div className="font-bold text-primary">
                      {formatThousands(protocol?.numValidNoOneMachineVotes)}
                    </div>
                  </Hint>
                  <Hint text={t("pct_supports_noone_machine_ballots")}>
                    <div className="font-bold text-primary ml-2">
                      {`(${formatPct(
                        100 *
                          ((protocol.numValidNoOneMachineVotes || 0) /
                            protocol.numValidMachineVotes),
                        2,
                      )})`}
                    </div>
                  </Hint>
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
                  tick={
                    topParties && (topParties.length <= 5 || isMachineOnly())
                  }
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
                  formatter={(value, name) => {
                    return (
                      <div className="flex min-w-[130px] items-center text-md">
                        {chartConfig[name as keyof typeof chartConfig]?.label ||
                          name}
                        <div className="ml-auto flex items-baseline gap-0.5 font-mono font-medium tabular-nums">
                          {value}
                        </div>
                      </div>
                    );
                  }}
                  content={<CustomTooltip />}
                />
                <Bar dataKey="totalVotes" radius={8}>
                  {topParties?.map((p) => (
                    <Cell key={`cell-${p.partyNum}`} fill={p.color} />
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
