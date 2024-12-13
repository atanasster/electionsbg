import { FC } from "react";
import { Newspaper, LaptopMinimal, Users, Flag } from "lucide-react";
import { SectionProtocol, Votes } from "@/data/dataTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useTranslation } from "react-i18next";
import { Hint } from "@/ux/Hint";
import { formatPct, formatThousands } from "@/data/utils";
import { useTopParties } from "@/data/useTopParties";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { VotesChart } from "./charts/VotesChart";

export const ProtocolSummary: FC<{
  protocol?: SectionProtocol;
  votes?: Votes[];
}> = ({ protocol, votes }) => {
  const { t } = useTranslation();
  const isXSmall = useMediaQueryMatch("xs");

  const topParties = useTopParties(votes, 4);
  return (
    protocol && (
      <div className="w-full items-center">
        <div
          className={`grid gap-4 sm:grid-cols-2 ${protocol?.numValidMachineVotes && protocol.numValidVotes ? "lg:grid-cols-4" : "lg:grid-cols-3"} my-4`}
        >
          {protocol ? (
            <>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-md font-medium">
                    {t("voters")}
                  </CardTitle>
                  <Users />
                </CardHeader>
                <CardContent>
                  <div className="flex">
                    <Hint text={t("total_voters_explainer")} underline={false}>
                      <div className="text-2xl xl:text-4xl my-4 mr-2 font-bold">
                        {formatThousands(protocol.totalActualVoters)}
                      </div>
                    </Hint>
                    {!!protocol.numRegisteredVoters && (
                      <Hint
                        text={t("pct_total_voters_explainer")}
                        underline={false}
                      >
                        <div className="text-xl xl:text-lg my-4 font-semibold ">
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
                      <Hint
                        text={t("pct_invalid_ballots_to_all_votes_explainer")}
                      >
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
              {!isXSmall && !!protocol.numValidVotes && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-md font-medium">
                      {t("paper_votes")}
                    </CardTitle>
                    <Newspaper />
                  </CardHeader>

                  <CardContent>
                    <div className="flex">
                      <Hint
                        text={t("valid_paper_votes_explainer")}
                        underline={false}
                      >
                        <div className="text-2xl xl:text-4xl my-4 font-bold justify-self-start">
                          {formatThousands(protocol.numValidVotes)}
                        </div>
                      </Hint>
                      <Hint
                        text={t("pct_paper_votes_explainer")}
                        underline={false}
                      >
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
                                {formatThousands(
                                  protocol.numInvalidBallotsFound,
                                )}
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
                                {formatThousands(
                                  protocol.numValidNoOnePaperVotes,
                                )}
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
              {!isXSmall && !!protocol.numValidMachineVotes && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-md font-medium">
                      {t("machine_votes")}
                    </CardTitle>
                    <LaptopMinimal />
                  </CardHeader>
                  <CardContent>
                    <div className="flex">
                      <Hint
                        text={t("total_machine_votes_explainer")}
                        underline={false}
                      >
                        <div className="text-2xl xl:text-4xl my-4 font-bold justify-self-start">
                          {formatThousands(protocol.numValidMachineVotes)}
                        </div>
                      </Hint>
                      {(protocol.numValidVotes ||
                        protocol.numValidMachineVotes) && (
                        <Hint
                          text={t("pct_machine_votes_explainer")}
                          underline={false}
                        >
                          <div className="text-xl xl:text-2xl my-4 font-semibold ml-2 ">
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
                            {formatThousands(
                              protocol?.numValidNoOneMachineVotes,
                            )}
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
                  <VotesChart votes={topParties} maxRows={6} />
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="h-48" />
          )}
        </div>
      </div>
    )
  );
};
