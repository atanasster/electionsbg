import { FC, useMemo } from "react";
import { Title } from "@/ux/Title";
import { Tooltip } from "@/ux/Tooltip";
import { Hint } from "@/ux/Hint";
import { VoteResults } from "@/data/dataTypes";
import { DataTable } from "@/ux/DataTable";
import { useTranslation } from "react-i18next";
import { addVotes, formatPct, formatThousands } from "@/data/utils";
import { LocationInfo, useSettlementsInfo } from "@/data/useSettlements";
import { createSearchParams, useSearchParams } from "react-router-dom";
import { PartyVotesXS } from "../../components/PartyVotesXS";
import { ProtocolSummary } from "../../components/ProtocolSummary";
import { Caption } from "@/ux/Caption";
import { Link } from "@/ux/Link";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReportRow, ReportRule, SettlementReportRow } from "./utils";
import { Row } from "@tanstack/react-table";
import { useRegions } from "@/data/useRegions";
import { useMunicipalities } from "@/data/useMunicipalities";

export type ColumnNames =
  | "ekatte"
  | "voterTurnout"
  | "pctSupportsNoOne"
  | "pctInvalidBallots"
  | "section"
  | "pctAdditionalVoters";
export const ReportTemplate: FC<{
  reportRule: ReportRule;
  locationFn: (row: Row<ReportRow>) => LocationInfo | undefined;
  votes: SettlementReportRow[];
  titleKey: string;
  levelKey: string;
  ruleKey: string;
  visibleColumns?: ColumnNames[];
}> = ({
  reportRule,
  votes,
  levelKey,
  titleKey,
  ruleKey,
  locationFn,
  visibleColumns = [],
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { findSettlement } = useSettlementsInfo();
  const { t, i18n } = useTranslation();
  const threshold = useMemo(
    () =>
      parseInt(
        searchParams.get("threshold") || reportRule.defaultThreshold.toString(),
      ),
    [reportRule.defaultThreshold, searchParams],
  );

  const summaryResults = useMemo(() => {
    const results: VoteResults = {
      actualTotal: 0,
      actualPaperVotes: 0,
      actualMachineVotes: 0,
      votes: [],
    };
    votes.forEach((v) => {
      addVotes(results, v.votes, v.protocol);
    });
    return results;
  }, [votes]);
  return (
    <div className={`w-full`}>
      <Title>{t(titleKey)}</Title>
      <div className="flex items-center justify-center pb-4 text-secondary-foreground ">
        <Label htmlFor="select_threshold" className="text-lg mr-2">
          {`${t(levelKey)} ${t(ruleKey)}:`}
        </Label>
        <Select
          value={threshold.toString()}
          onValueChange={(e) => {
            setSearchParams(
              {
                threshold: e,
              },
              { replace: true },
            );
            // setThreshold(parseInt(e));
          }}
        >
          <SelectTrigger id="select_threshold" className="w-[100px] text-lg">
            <SelectValue placeholder={threshold.toString()} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="5">5%</SelectItem>
            <SelectItem value="10">10%</SelectItem>
            <SelectItem value="20">20%</SelectItem>
            <SelectItem value="30">30%</SelectItem>
            <SelectItem value="40">40%</SelectItem>
            <SelectItem value="50">50%</SelectItem>
            <SelectItem value="60">60%</SelectItem>
            <SelectItem value="70">70%</SelectItem>
            <SelectItem value="80">80%</SelectItem>
            <SelectItem value="90">90%</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {!!summaryResults.protocol && (
        <ProtocolSummary
          protocol={summaryResults.protocol}
          votes={summaryResults.votes}
        />
      )}
      <DataTable
        pageSize={25}
        columns={[
          {
            accessorKey: "partyVotes.key",
            header: t("party"),
            size: 70,
            cell: ({ row }) => {
              const info = locationFn(row);
              return (
                <Tooltip
                  content={
                    <div>
                      <Caption>
                        {i18n.language === "bg" ? info?.name : info?.name_en}
                      </Caption>
                      <PartyVotesXS votes={row.original.votes} />
                    </div>
                  }
                >
                  <div
                    className="text-white text-right px-2 font-bold w-24"
                    style={{
                      backgroundColor: row.original["partyVotes"]["color"],
                    }}
                  >
                    {row.original["partyVotes"]["nickName"]}
                  </div>
                </Tooltip>
              );
            },
          },
          {
            accessorKey: "oblast",
            header: t("region"),
            cell: ({ row }) => {
              const region = findRegion(row.getValue("oblast"));
              return (
                <Link
                  to={{
                    pathname: "/municipality",
                    search: createSearchParams({
                      region: row.original.oblast || "",
                    }).toString(),
                  }}
                >
                  {i18n.language === "bg" ? region?.name : region?.name_en}
                </Link>
              );
            },
          },
          {
            accessorKey: "obshtina",
            header: t("municipality"),
            cell: ({ row }) => {
              const municipality = findMunicipality(row.getValue("obshtina"));
              return (
                <Link
                  to={{
                    pathname: "/settlement",
                    search: createSearchParams({
                      region: row.original.oblast || "",
                      municipality: row.original.obshtina || "",
                    }).toString(),
                  }}
                >
                  {i18n.language === "bg"
                    ? municipality?.name
                    : municipality?.name_en}
                </Link>
              );
            },
          },
          {
            accessorKey: "ekatte",
            hidden: !visibleColumns.includes("ekatte"),
            header: t("settlement"),
            cell: ({ row }) => {
              const settlement = findSettlement(row.getValue("ekatte"));
              return (
                <Link
                  to={{
                    pathname: "/sections",
                    search: createSearchParams({
                      region: row.original.oblast || "",
                      municipality: row.original.obshtina || "",
                      settlement: row.original.ekatte || "",
                    }).toString(),
                  }}
                >
                  {i18n.language === "bg"
                    ? settlement?.name
                    : settlement?.name_en}
                </Link>
              );
            },
          },
          {
            accessorKey: "section",
            hidden: !visibleColumns.includes("section"),
            header: t("section"),
            cell: ({ row }) => (
              <Link
                to={{
                  pathname: "/section",
                  search: createSearchParams({
                    section: row.getValue("section"),
                  }).toString(),
                }}
              >
                {row.getValue("section")}
              </Link>
            ),
          },
          {
            accessorKey: "voterTurnout",
            hidden: !visibleColumns.includes("voterTurnout"),
            header: () => (
              <Hint text={t("pct_total_voters_explainer")}>
                <div>{t("voter_turnout")}</div>
              </Hint>
            ),
            cell: ({ row }) => {
              return (
                <div className="px-4 py-2 text-right">
                  {formatPct(row.getValue("voterTurnout"), 2)}
                </div>
              );
            },
          },
          {
            accessorKey: "pctAdditionalVoters",
            hidden: !visibleColumns.includes("pctAdditionalVoters"),
            header: () => (
              <Hint text={t("pct_additional_voters_explainer")}>
                <div>{t("additional_voters")}</div>
              </Hint>
            ),
            cell: ({ row }) => {
              return (
                <div className="px-4 py-2 text-right">
                  {formatPct(row.getValue("pctAdditionalVoters"), 2)}
                </div>
              );
            },
          },

          {
            accessorKey: "pctSupportsNoOne",
            hidden: !visibleColumns.includes("pctSupportsNoOne"),
            header: () => (
              <Hint text={t("num_supports_no_one_explainer")}>
                <div>{t("support_no_one")}</div>
              </Hint>
            ),
            cell: ({ row }) => {
              return (
                <div className="px-4 py-2 text-right">
                  {formatPct(row.getValue("pctSupportsNoOne"), 2)}
                </div>
              );
            },
          },
          {
            accessorKey: "pctInvalidBallots",
            hidden: !visibleColumns.includes("pctInvalidBallots"),
            header: () => (
              <Hint text={t("pct_invalid_paper_ballots")}>
                <div>{t("invalid_ballots")}</div>
              </Hint>
            ),
            cell: ({ row }) => {
              return (
                <div className="px-4 py-2 text-right">
                  {formatPct(row.getValue("pctInvalidBallots"), 2)}
                </div>
              );
            },
          },

          {
            accessorKey: "partyVotes.paperVotes",
            header: () => (
              <Hint text={t("num_paper_ballots_found_explainer")}>
                <div>{t("paper_votes")}</div>
              </Hint>
            ),
            cell: ({ row }) => {
              return (
                <div className="px-4 py-2 text-right">
                  {formatThousands(row.original["partyVotes"]["paperVotes"])}
                </div>
              );
            },
          },
          {
            accessorKey: "partyVotes.machineVotes",
            header: () => (
              <Hint text={t("total_machine_votes_explainer")}>
                <div>{t("machine_votes")}</div>
              </Hint>
            ),
            cell: ({ row }) => {
              return (
                <div className="px-4 py-2 text-right">
                  {formatThousands(row.original["partyVotes"]["machineVotes"])}
                </div>
              );
            },
          },
          {
            accessorKey: "partyVotes.totalVotes",
            header: () => (
              <Hint text={t("total_party_votes_explainer")}>
                <div>{t("total_votes")}</div>
              </Hint>
            ),
            cell: ({ row }) => {
              return (
                <div className="px-4 py-2 text-right">
                  {formatThousands(row.original["partyVotes"]["totalVotes"])}
                </div>
              );
            },
          },
          {
            accessorKey: "pctPartyVote",
            header: () => (
              <Hint text={t("pct_party_votes_explainer")}>
                <div>%</div>
              </Hint>
            ),
            cell: ({ row }) => {
              return (
                <div className="px-4 py-2 text-right">
                  {formatPct(row.getValue("pctPartyVote"), 2)}
                </div>
              );
            },
          },
        ]}
        data={votes}
      />
    </div>
  );
};
