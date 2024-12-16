import { FC, useMemo, useState } from "react";
import { Title } from "@/ux/Title";
import { Hint } from "@/ux/Hint";
import { ReportRow, Votes } from "@/data/dataTypes";
import { DataTable } from "@/ux/DataTable";
import { useTranslation } from "react-i18next";
import { addVotes, formatPct, formatThousands, localDate } from "@/data/utils";
import { useSettlementsInfo } from "@/data/useSettlements";
import { useSearchParams } from "react-router-dom";
import { Link } from "@/ux/Link";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRegions } from "@/data/useRegions";
import { useMunicipalities } from "@/data/useMunicipalities";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { useTouch } from "@/ux/TouchProvider";
import { PartyLabel } from "@/screens/components/PartyLabel";
import { usePartyInfo } from "@/data/usePartyInfo";
import { useElectionContext } from "@/data/ElectionContext";
import { SelectParties } from "@/screens/components/charts/SelectParties";

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
  const isTouch = useTouch();
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
        <div className="flex items-center ">
          <Hint text={t("include_abroad_explainer")}>
            <div className="flex items-center space-x-2">
              <Switch
                id="include_abroad"
                checked={includeAbroad}
                onCheckedChange={(value) => {
                  localStorage.setItem(
                    "reports_include_abroad",
                    value ? "true" : "false",
                  );
                  setIncludeAbroad(value);
                }}
              />
              <Label
                className="text-secondary-foreground"
                htmlFor={isTouch ? undefined : "include_abroad"}
              >
                {isSmall ? t("include_abroad_short") : t("include_abroad")}
              </Label>
            </div>
          </Hint>
        </div>
      </div>
      <DataTable
        pageSize={25}
        stickyColumn={true}
        columns={[
          {
            accessorKey: "party.nickName",
            header: t("party"),
            size: 70,
            cell: ({ row }) => {
              return (
                <Hint
                  text={`${row.original.party ? row.original.party.name : t("unknown_party")}`}
                >
                  <PartyLabel party={row.original.party} />
                </Hint>
              );
            },
          },
          {
            accessorKey: "oblast",
            header: t("region"),
            cell: ({ row }) => {
              const region = findRegion(row.getValue("oblast"));
              return (
                <Link to={`/municipality/${row.original.oblast}`}>
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
                <Link to={`/settlement/${row.original.obshtina}`}>
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
                <Link to={`/sections/${row.original.ekatte}`}>
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
                  search: {
                    section: row.getValue("section"),
                  },
                }}
              >
                {row.getValue("section")}
              </Link>
            ),
          },
          {
            accessorKey: "totalVotes",
            header: () => (
              <Hint text={t("total_party_votes_explainer")}>
                <div>{isSmall ? t("votes") : t("total_votes")}</div>
              </Hint>
            ),
            cell: ({ row }) => {
              return (
                <div className="px-4 py-2 text-right">
                  {formatThousands(row.original.totalVotes)}
                </div>
              );
            },
          },
          {
            accessorKey: "pctPartyVote",
            hidden: hiddenColumns.includes("pctPartyVote"),
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
                  {formatPct(row.original.value, 2)}
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
                  {formatPct(row.original.value, 2)}
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
                  {formatPct(row.original.value, 2)}
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
                  {formatPct(row.original.value, 2)}
                </div>
              );
            },
          },
          {
            accessorKey: "prevYearVotes",
            hidden: priorElections && !visibleColumns.includes("prevYearVotes"),
            header: (
              <Hint text={t("prev_election_votes_explainer")}>
                <div>
                  {priorElections
                    ? localDate(priorElections.name)
                    : t("prior_elections")}
                </div>
              </Hint>
            ) as never,
            cell: ({ row }) => (
              <div className="px-4 py-2 text-right">
                {formatThousands(row.getValue("prevYearVotes"))}
              </div>
            ),
          },
          {
            accessorKey: "prevYearChangeVotes",
            hidden: priorElections && !visibleColumns.includes("prevYearVotes"),
            header: (
              <Hint text={t("prev_election_change_votes_explainer")}>
                <div>{t("change")}</div>
              </Hint>
            ) as never,
            cell: ({ row }) => (
              <div
                className={`px-4 py-2 text-right ${row.original.prevYearChangeVotes && row.original.prevYearChangeVotes < 0 ? "text-destructive" : "text-secondary-foreground"}`}
              >
                {formatThousands(row.original.prevYearChangeVotes)}
              </div>
            ),
          },
          {
            accessorKey: "value",
            hidden: !visibleColumns.includes("prevYearChange"),
            header: (
              <Hint text={t("pct_prev_election_votes_explainer")}>
                <div>{isSmall ? "+/-%" : `% ${t("change")}`}</div>
              </Hint>
            ) as never,
            cell: ({ row }) => {
              const pctChange: number = row.original.value;
              return (
                <div
                  className={`px-4 py-2 font-bold text-right ${pctChange && pctChange < 0 ? "text-destructive" : "text-secondary-foreground"}`}
                >
                  {formatPct(pctChange, 2)}
                </div>
              );
            },
          },
        ]}
        data={data || []}
      />
    </div>
  );
};
