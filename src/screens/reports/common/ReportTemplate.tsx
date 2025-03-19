import { FC, useMemo, useState } from "react";
import { Title } from "@/ux/Title";
import { PartyInfo, ReportRow } from "@/data/dataTypes";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { useTranslation } from "react-i18next";
import { localDate } from "@/data/utils";
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
import { PartyLink } from "@/screens/components/party/PartyLink";
import { HintedSwitch } from "@/ux/HintedSwitch";
import { SettlementLink } from "@/screens/components/settlements/SettlementLink";
import { MunicipalityLink } from "@/screens/components/municipalities/MunicipalityLink";
import { SectionLink } from "@/screens/components/sections/SectionLink";
import { RegionLink } from "@/screens/components/regions/RegionLink";
import { Caption } from "@/ux/Caption";

export type ReportColumns = DataTableColumns<
  ReportRow & {
    party?: PartyInfo;
    bottomParty?: PartyInfo;
    topParty?: PartyInfo;
  },
  unknown
>;
export type ColumnNames =
  | "party"
  | "ekatte"
  | "voterTurnout"
  | "pctSupportsNoOne"
  | "pctInvalidBallots"
  | "section"
  | "pctAdditionalVoters"
  | "prevYearVotes"
  | "prevYearChange"
  | "pctPartyVote"
  | "votes"
  | "recount"
  | "top_party"
  | "bottom_party";
export const ReportTemplate: FC<{
  defaultThreshold?: number;
  bigger?: boolean;
  votes?: ReportRow[];
  titleKey: string;
  levelKey: string;
  ruleKey?: string;
  visibleColumns?: ColumnNames[];
  hiddenColumns?: ColumnNames[];
  extraColumns?: ReportColumns;
}> = ({
  defaultThreshold,
  bigger = true,
  votes,
  levelKey,
  titleKey,
  ruleKey,
  hiddenColumns = [],
  visibleColumns = [],
  extraColumns = [],
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { priorElections } = useElectionContext();
  const [includeAbroad, setIncludeAbroad] = useState(
    localStorage.getItem("reports_include_abroad") === "true",
  );
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { findSettlement } = useSettlementsInfo();
  const { findParty } = usePartyInfo();
  const { t, i18n } = useTranslation();
  const isSmall = useMediaQueryMatch("sm");
  const threshold = useMemo<number | undefined>(
    () =>
      defaultThreshold
        ? parseInt(searchParams.get("threshold") || defaultThreshold.toString())
        : undefined,
    [defaultThreshold, searchParams],
  );
  const data = useMemo(
    () =>
      votes
        ?.map((v) => {
          const party = v.partyNum ? findParty(v.partyNum) : undefined;
          const bottomParty = v.bottomPartyChange
            ? findParty(v.bottomPartyChange.partyNum)
            : undefined;
          const topParty = v.topPartyChange
            ? findParty(v.topPartyChange.partyNum)
            : undefined;
          return {
            ...v,
            party,
            topParty,
            bottomParty,
            prevYearChangeVotes: (v.totalVotes || 0) - (v.prevYearVotes || 0),
          };
        })
        ?.filter((vote) => {
          return (
            (includeAbroad || vote.oblast !== "32") &&
            (!threshold ||
              (bigger ? vote.value > threshold : vote.value < -threshold))
          );
        }),
    [votes, findParty, includeAbroad, bigger, threshold],
  );
  const columns: ReportColumns = useMemo(
    () => [
      {
        accessorKey: "party.nickName",
        header: t("party"),
        hidden: hiddenColumns.includes("party"),
        size: 70,
        cell: ({ row }) =>
          row.original.party && <PartyLink party={row.original.party} />,
      },
      {
        accessorKey: "oblast",
        header: t("region"),
        accessorFn: (row) => {
          const region = findRegion(row.oblast);
          return i18n.language === "bg" ? region?.name : region?.name_en;
        },
        cell: ({ row }) => <RegionLink oblast={row.original.oblast} />,
      },
      {
        accessorKey: "obshtina",
        header: t("municipality"),
        accessorFn: (row) => {
          const municipality = findMunicipality(row.obshtina);
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
        accessorFn: (row) => {
          const settlement = findSettlement(row.ekatte);
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
        accessorKey: "paperVotes",
        hidden: !visibleColumns.includes("votes"),
        header: t("paper_votes"),
        dataType: "thousands",
      },
      {
        accessorKey: "machineVotes",
        hidden: !visibleColumns.includes("votes"),
        header: t("machine_votes"),
        dataType: "thousands",
      },
      {
        accessorKey: "totalVotes",
        hidden:
          hiddenColumns.includes("party") && !visibleColumns.includes("votes"),
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
        hidden:
          !visibleColumns.includes("top_party") &&
          (!visibleColumns.includes("recount") ||
            hiddenColumns.includes("top_party")),
        headerHint: t("num_votes_recount_explainer"),
        header: t("top_party_recount_gainer"),
        id: "top_party_recount_gainer",
        colSpan: 2,
        columns: [
          {
            accessorKey: "topParty.nickName",
            className: "font-bold",
            header: t("party"),
            cell: ({ row }) =>
              row.original.topParty && (
                <PartyLink party={row.original.topParty} />
              ),
          },
          {
            accessorKey: "topPartyChange.change",
            className: "font-bold",
            header: t("change"),
            dataType: "thousandsChange",
          },
        ],
      },
      {
        hidden:
          !visibleColumns.includes("bottom_party") &&
          !visibleColumns.includes("recount"),
        headerHint: t("num_votes_recount_explainer"),
        header: t("top_party_recount_loser"),
        id: "top_party_recount_loser",
        colSpan: 2,
        columns: [
          {
            accessorKey: "bottomParty.nickName",
            className: "font-bold",
            header: t("party"),
            cell: ({ row }) =>
              row.original.bottomParty && (
                <PartyLink party={row.original.bottomParty} />
              ),
          },
          {
            accessorKey: "bottomPartyChange.change",
            className: "font-bold",
            header: t("change"),
            dataType: "thousandsChange",
          },
        ],
      },
      {
        hidden: !visibleColumns.includes("recount"),
        header: t("total"),
        colSpan: 2,
        columns: [
          {
            accessorKey: "addedVotes",
            className: "font-bold",
            header: t("added"),
            headerHint: t("num_added_recount_votes"),
            dataType: "thousandsChange",
          },
          {
            accessorKey: "removedVotes",
            className: "font-bold",
            header: t("removed"),
            headerHint: t("num_removed_recount_votes"),
            dataType: "thousandsChange",
          },
        ],
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
      ...extraColumns,
    ],
    [
      findMunicipality,
      findRegion,
      findSettlement,
      hiddenColumns,
      i18n.language,
      isSmall,
      priorElections,
      t,
      visibleColumns,
      extraColumns,
    ],
  );
  return (
    <div className={`w-full`}>
      <Title description="election anomalies report" className="md:py-8">
        {t(titleKey)}
      </Title>

      <div className="flex items-center justify-center pb-4 text-secondary-foreground ">
        {!ruleKey && <Caption>{`${t(levelKey)}`}</Caption>}
        {!!ruleKey && (
          <>
            <Label
              htmlFor="select_threshold"
              className="text-md md:text-lg mr-2"
            >
              {`${t(levelKey)}${ruleKey ? ` ${t(ruleKey)}` : ""}`}
            </Label>

            <Select
              value={threshold?.toString()}
              onValueChange={(e) => {
                searchParams.set("threshold", e);
                setSearchParams(searchParams, { replace: true });
                // setThreshold(parseInt(e));
              }}
            >
              <SelectTrigger
                id="select_threshold"
                className="w-[100px] text-lg"
              >
                <SelectValue placeholder={threshold?.toString()} />
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
          </>
        )}
      </div>

      <DataTable
        title={t(titleKey)}
        pageSize={25}
        stickyColumn={true}
        toolbarItems=<HintedSwitch
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
        columns={columns}
        data={data || []}
      />
    </div>
  );
};
