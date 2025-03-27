import { FC, PropsWithChildren } from "react";
import { Newspaper, LaptopMinimal, Users, Flag } from "lucide-react";
import { RecountOriginal, VoteResults } from "@/data/dataTypes";
import { useTranslation } from "react-i18next";
import { Hint } from "@/ux/Hint";
import { formatPct, formatThousands } from "@/data/utils";
import { useTopParties } from "@/data/parties/useTopParties";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { VotesChart } from "../charts/VotesChart";
import { LabelXL } from "./LabelXL";
import { LabelL } from "./LabelL";
import { ProtocolCard } from "../../../ux/ProtocolCard";
import { AccordionSummary } from "@/ux/AccordionSummary";

export const ProtocolSummary: FC<
  PropsWithChildren<{
    results?: VoteResults;
    original?: RecountOriginal;
  }>
> = ({ results, children }) => {
  const { t } = useTranslation();

  const { protocol, votes } = results || {};
  const isXSmall = useMediaQueryMatch("xs");
  const topParties = useTopParties(votes, 4);
  return (
    protocol && (
      <AccordionSummary>
        <div className="w-full items-center">
          {children}
          <div
            className={`grid gap-4 sm:grid-cols-2 ${protocol?.numValidMachineVotes && protocol.numValidVotes ? "lg:grid-cols-4" : "lg:grid-cols-3"} my-4`}
          >
            {protocol ? (
              <>
                <ProtocolCard title={t("voters")} icon={<Users />}>
                  <div className="flex">
                    <Hint text={t("total_voters_explainer")} underline={false}>
                      <LabelXL>
                        {formatThousands(protocol.totalActualVoters)}
                      </LabelXL>
                    </Hint>
                    {!!protocol.numRegisteredVoters && (
                      <Hint
                        text={t("pct_total_voters_explainer")}
                        underline={false}
                      >
                        <LabelL>
                          {`(${formatPct(
                            100 *
                              (protocol.totalActualVoters /
                                protocol.numRegisteredVoters),
                            1,
                          )})`}
                        </LabelL>
                      </Hint>
                    )}
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground leading-6">
                    <Hint text={t("num_all_voters_explainer")}>
                      <div>{`${t("voters")}: `}</div>
                    </Hint>
                    <Hint text={t("num_all_voters_explainer")}>
                      <div className="font-bold text-primary">
                        {formatThousands(
                          (protocol.numRegisteredVoters || 0) +
                            (protocol.numAdditionalVoters || 0),
                        )}
                      </div>
                    </Hint>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <Hint text={t("valid_votes_explainer")}>
                      <div>{`${t("valid_votes")}: `}</div>
                    </Hint>
                    <div className="flex">
                      <Hint text={t("valid_votes_explainer")}>
                        <span className="font-bold text-primary">
                          {formatThousands(
                            (protocol.numValidMachineVotes || 0) +
                              (protocol.numValidVotes || 0),
                          )}
                        </span>
                      </Hint>
                      {protocol.numRegisteredVoters && (
                        <Hint text={t("pct_valid_votes_explainer")}>
                          <div className="font-bold text-primary ml-2">
                            {`(${formatPct(
                              100 *
                                (((protocol.numValidMachineVotes || 0) +
                                  (protocol.numValidVotes || 0)) /
                                  protocol.numRegisteredVoters),
                              2,
                            )})`}
                          </div>
                        </Hint>
                      )}
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
                  {(protocol.numValidNoOnePaperVotes !== undefined ||
                    protocol.numValidNoOneMachineVotes !== undefined) && (
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
                  )}
                </ProtocolCard>

                {!isXSmall && !!protocol.numValidVotes && (
                  <ProtocolCard title={t("paper_votes")} icon={<Newspaper />}>
                    <div className="flex">
                      <Hint
                        text={t("valid_paper_votes_explainer")}
                        underline={false}
                      >
                        <LabelXL>
                          {formatThousands(protocol.numValidVotes)}
                        </LabelXL>
                      </Hint>
                      <Hint
                        text={t("pct_paper_votes_explainer")}
                        underline={false}
                      >
                        <LabelL>
                          {`(${formatPct(
                            100 *
                              (protocol.numValidVotes /
                                (protocol.numValidVotes +
                                  (protocol.numValidMachineVotes || 0))),
                            1,
                          )})`}
                        </LabelL>
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
                  </ProtocolCard>
                )}
                {!isXSmall && !!protocol.numValidMachineVotes && (
                  <ProtocolCard
                    icon={<LaptopMinimal />}
                    title={t("machine_votes")}
                  >
                    <div className="flex">
                      <Hint
                        text={t("total_machine_votes_explainer")}
                        underline={false}
                      >
                        <LabelXL>
                          {formatThousands(protocol.numValidMachineVotes)}
                        </LabelXL>
                      </Hint>
                      {(protocol.numValidVotes ||
                        protocol.numValidMachineVotes) && (
                        <Hint
                          text={t("pct_machine_votes_explainer")}
                          underline={false}
                        >
                          <LabelL>
                            {`(${formatPct(
                              100 *
                                (protocol.numValidMachineVotes /
                                  ((protocol.numValidVotes || 0) +
                                    (protocol.numValidMachineVotes || 0))),
                              1,
                            )})`}
                          </LabelL>
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
                  </ProtocolCard>
                )}

                {!!topParties?.length && (
                  <ProtocolCard icon={<Flag />} title={t("top_parties")}>
                    <VotesChart votes={topParties} maxRows={6} />
                  </ProtocolCard>
                )}
              </>
            ) : (
              <div className="h-48" />
            )}
          </div>
        </div>
      </AccordionSummary>
    )
  );
};
