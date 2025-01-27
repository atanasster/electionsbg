import { FC, useMemo, useState } from "react";
import { Title } from "@/ux/Title";
import { ReportRow, Votes } from "@/data/dataTypes";
import { DataTable } from "@/ux/data_table/DataTable";
import { useTranslation } from "react-i18next";
import { addVotes, localDate } from "@/data/utils";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useSearchParams } from "react-router-dom";
import { Label } from "@/components/ui/label";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRegions } from "@/data/regions/useRegions";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { useElectionContext } from "@/data/ElectionContext";
import { SelectParties } from "@/screens/components/charts/SelectParties";
import { PartyLink } from "@/screens/components/party/PartyLink";
import { HintedSwitch } from "@/ux/HintedSwitch";
import { SettlementLink } from "@/screens/components/settlements/SettlementLink";
import { MunicipalityLink } from "@/screens/components/municipalities/MunicipalityLink";
import { SectionLink } from "@/screens/components/sections/SectionLink";
import { RegionLink } from "@/screens/components/regions/RegionLink";

export type ColumnNames =
  | "ekatte"
  | "voterTurnout"
  | "pctSupportsNoOne"
  | "pctInvalidBallots"
  | "section"
  | "pctAdditionalVoters"
  | "prevYearVotes"
  | "prevYearChange"
  | "pctPartyVote";
export const ReportTemplate: FC<{
  defaultThreshold: number;
  bigger?: boolean;
  votes?: ReportRow[];
  titleKey: string;
  levelKey: string;
  ruleKey: string;
  visibleColumns?: ColumnNames[];
  hiddenColumns?: ColumnNames[];
}> = ({
  defaultThreshold,
  bigger = true,
  votes,
  levelKey,
  titleKey,
  ruleKey,
  hiddenColumns = [],
  visibleColumns = [],
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { priorElections } = useElectionContext();
  const [unselected, setUnselected] = useState<string[]>([]);
  const [includeAbroad, setIncludeAbroad] = useState(
    localStorage.getItem("reports_include_abroad") === "true",
  );
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { findSettlement } = useSettlementsInfo();
  const { findParty } = usePartyInfo();
  const { t, i18n } = useTranslation();
  const isSmall = useMediaQueryMatch("sm");
  const threshold = useMemo(
    () =>
      parseInt(searchParams.get("threshold") || defaultThreshold.toString()),
    [defaultThreshold, searchParams],
  );

  const selectedData = useMemo(
    () =>
      votes
        ?.map((v) => {
          const party = findParty(v.partyNum);
          return {
            ...v,
            party,
            prevYearChangeVotes: v.totalVotes - (v.prevYearVotes || 0),
          };
        })
        ?.filter((vote) => {
          return (
            (includeAbroad || vote.oblast !== "32") &&
            (bigger ? vote.value > threshold : vote.value < -threshold)
          );
        }),
    [votes, findParty, includeAbroad, bigger, threshold],
  );
  const data = useMemo(
    () =>
      selectedData?.filter((vote) => {
        return !unselected.includes(vote.party?.nickName);
      }),
    [selectedData, unselected],
  );
  const summaryVotes = useMemo(() => {
    const allVotes = selectedData?.reduce((acc: Votes[], v) => {
      const added = addVotes(
        [
          {
            ...v.party,
            partyNum: v.partyNum,
            totalVotes: bigger
              ? v.totalVotes
              : (v.prevYearVotes || 0) - v.totalVotes,
          },
        ],
        acc,
      ).sort((a, b) => b.totalVotes - a.totalVotes);
      return added;
    }, []);

    return allVotes;
  }, [bigger, selectedData]);

  return (
    <div className={`w-full`}>
      <Title description="election anomalies report">{t(titleKey)}</Title>
      <div className="flex items-center justify-center pb-4 text-secondary-foreground ">
        <Label htmlFor="select_threshold" className="text-md md:text-lg mr-2">
          {`${t(levelKey)} ${t(ruleKey)}:`}
        </Label>
        <Select
          value={threshold.toString()}
          onValueChange={(e) => {
            searchParams.set("threshold", e);
            setSearchParams(searchParams, { replace: true });
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
      <div className="flex justify-between py-2 w-full">
        <SelectParties
          votes={summaryVotes}
          onChangeSelected={setUnselected}
          subTitle={`${t(levelKey)} ${t(ruleKey)} ${threshold}%`}
        />
        <HintedSwitch
          hint={t("include_abroad_explainer")}
          label={isSmall ? t("include_abroad_short") : t("include_abroad")}
          value={includeAbroad}
          setValue={(value) => {
            localStorage.setItem(
              "reports_include_abroad",
              value ? "true" : "false",
            );
            setIncludeAbroad(value);
          }}
        />
      </div>
      <DataTable
        title={t(titleKey)}
        pageSize={25}
        stickyColumn={true}
        columns={[
          {
            accessorKey: "party.nickName",
            header: t("party"),
            cellValue: ({ row }) => row.original.party.nickName,
            size: 70,
            cell: ({ row }) =>
              row.original.party ? (
                <PartyLink party={row.original.party} />
              ) : (
                t("unknown_party")
              ),
          },
          {
            accessorKey: "oblast",
            header: t("region"),
            cellValue: ({ row }) => {
              const region = findRegion(row.getValue("oblast"));
              return i18n.language === "bg" ? region?.name : region?.name_en;
            },
            cell: ({ row }) => <RegionLink oblast={row.original.oblast} />,
          },
          {
            accessorKey: "obshtina",
            header: t("municipality"),
            cellValue: ({ row }) => {
              const municipality = findMunicipality(row.getValue("obshtina"));
              return i18n.language === "bg"
                ? municipality?.name
                : municipality?.name_en;
            },
            cell: ({ row }) => (
              <MunicipalityLink obshtina={row.original.obshtina} />
            ),
          },
          {
            accessorKey: "ekatte",
            hidden: !visibleColumns.includes("ekatte"),
            header: t("settlement"),
            cellValue: ({ row }) => {
              const settlement = findSettlement(row.getValue("ekatte"));
              return i18n.language === "bg"
                ? settlement?.name
                : settlement?.name_en;
            },
            cell: ({ row }) => <SettlementLink ekatte={row.original.ekatte} />,
          },
          {
            accessorKey: "section",
            hidden: !visibleColumns.includes("section"),
            header: t("section"),
            cell: ({ row }) => <SectionLink section={row.original.section} />,
          },
          {
            accessorKey: "totalVotes",
            headerHint: t("total_party_votes_explainer"),
            header: isSmall ? t("votes") : t("total_votes"),
            dataType: "thousands",
          },
          {
            accessorKey: "pctPartyVote",
            hidden: hiddenColumns.includes("pctPartyVote"),
            headerHint: t("pct_party_votes_explainer"),
            header: "%",
            dataType: "percent",
          },
          {
            accessorKey: "value",
            hidden: !visibleColumns.includes("voterTurnout"),
            headerHint: t("pct_total_voters_explainer"),
            header: t("voter_turnout"),
            dataType: "percent",
          },
          {
            accessorKey: "value",
            hidden: !visibleColumns.includes("pctAdditionalVoters"),
            headerHint: t("pct_additional_voters_explainer"),
            header: t("additional_voters"),
            dataType: "percent",
          },
          {
            accessorKey: "value",
            hidden: !visibleColumns.includes("pctSupportsNoOne"),
            headerHint: t("num_supports_no_one_explainer"),
            header: t("support_no_one"),
            dataType: "percent",
          },
          {
            accessorKey: "value",
            hidden: !visibleColumns.includes("pctInvalidBallots"),
            headerHint: t("pct_invalid_paper_ballots"),
            header: t("invalid_ballots"),
            dataType: "percent",
          },
          {
            accessorKey: "prevYearVotes",
            hidden: priorElections && !visibleColumns.includes("prevYearVotes"),
            headerHint: t("prev_election_votes_explainer"),
            header: priorElections
              ? localDate(priorElections.name)
              : t("prior_elections"),
            dataType: "thousands",
          },
          {
            accessorKey: "prevYearChangeVotes",
            hidden: priorElections && !visibleColumns.includes("prevYearVotes"),
            headerHint: t("prev_election_change_votes_explainer"),
            header: t("change"),
            dataType: "thousands",
          },
          {
            accessorKey: "value",
            hidden: !visibleColumns.includes("prevYearChange"),
            headerHint: t("pct_prev_election_votes_explainer"),
            header: isSmall ? "+/-%" : `% ${t("change")}`,
            className: "font-bold",
            dataType: "pctChange",
          },
        ]}
        data={data || []}
      />
    </div>
  );
};
