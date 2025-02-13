import { useMemo } from "react";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import { ElectionResults, PartyInfo, Votes } from "@/data/dataTypes";
import { useTranslation } from "react-i18next";
import { useRegions } from "@/data/regions/useRegions";
import { topParty, totalActualVoters } from "@/data/utils";
import { PartyLink } from "./party/PartyLink";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Caption } from "@/ux/Caption";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { Link } from "@/ux/Link";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";

type ColumnDataType = Partial<PartyInfo> & {
  oblast: string;
  obshtina?: string;
  ekatte?: string;
  section?: string;
  votes: Votes[];
  totalVotes?: number;
  pctVotes?: number;
};

type ColumnType = "oblast" | "obshtina" | "ekatte" | "section";

export function AreaVotesTable<DataType extends ElectionResults>({
  title,
  visibleColumns = [],
  votes,
  votesAreas,
}: {
  title: string;
  visibleColumns?: ColumnType[];
  votes?: DataType[];
  votesAreas: (data: DataType) => {
    oblast: string;
    obshtina?: string;
    ekatte?: string;
    section?: string;
  };
}) {
  const { t, i18n } = useTranslation();
  const { findParty } = usePartyInfo();
  const { findRegion } = useRegions();
  const { findMunicipality } = useMunicipalities();
  const { findSettlement } = useSettlementsInfo();
  const isXSmall = useMediaQueryMatch("xs");
  const isSmall = useMediaQueryMatch("sm");

  const { data, hasPaperVotes, hasMachineVotes } = useMemo(() => {
    let hasPaperVotes = false;
    let hasMachineVotes = false;
    const data: ColumnDataType[] | undefined = votes?.map((vote) => {
      const party = topParty(vote.results.votes);
      const totalVotes = totalActualVoters(vote.results.votes);
      const fullParty = party ? findParty(party?.partyNum) : undefined;
      if (party?.paperVotes) {
        hasPaperVotes = true;
      }
      if (party?.machineVotes) {
        hasMachineVotes = true;
      }
      return {
        ...votesAreas(vote),
        votes: vote.results.votes,
        totalVotes,
        pctVotes:
          party?.totalVotes && totalVotes
            ? 100 * (party?.totalVotes / totalVotes)
            : 0,
        ...party,
        ...fullParty,
      };
    });
    return { data, hasMachineVotes, hasPaperVotes };
  }, [findParty, votes, votesAreas]);
  const columns: DataTableColumns<ColumnDataType, unknown> = useMemo(
    () => [
      {
        accessorKey: "oblast",
        header: t("region"),
        hidden: !visibleColumns.includes("oblast"),
        className: "font-bold",
        accessorFn: (row) => {
          const region = findRegion(row.oblast);
          return i18n.language === "bg"
            ? region?.long_name || region?.name
            : region?.long_name_en || region?.name_en;
        },
        cell: ({ row }) => {
          const region = findRegion(row.original.oblast);
          return (
            <Link to={`/municipality/${row.original.oblast}`}>
              {i18n.language === "bg"
                ? region?.long_name || region?.name
                : region?.long_name_en || region?.name_en}
            </Link>
          );
        },
      },
      {
        accessorKey: "obshtina",
        hidden: !visibleColumns.includes("obshtina"),
        header: t("municipality"),
        className: "font-bold",
        accessorFn: (row) => {
          const municipality = findMunicipality(row.obshtina);
          return i18n.language === "bg"
            ? municipality?.name
            : municipality?.name_en;
        },
        cell: ({ row }) => {
          const municipality = findMunicipality(row.original.obshtina);
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
        className: "font-bold",
        header: t("settlement"),
        accessorFn: (row) => {
          const settlement = findSettlement(row.ekatte);
          return i18n.language === "bg"
            ? settlement?.name
            : settlement?.name_en;
        },
        cell: ({ row }) => {
          const settlement = findSettlement(row.original.ekatte);
          return (
            <Link to={`/sections/${row.original.ekatte}`}>
              {i18n.language === "bg" ? settlement?.name : settlement?.name_en}
            </Link>
          );
        },
      },
      {
        accessorKey: "section",
        className: "font-bold",
        hidden: !visibleColumns.includes("section"),
        header: t("section"),
        cell: ({ row }) => (
          <Link to={`/section/${row.original.section}`}>
            {row.original.section}
          </Link>
        ),
      },
      {
        accessorKey: "partyNum",
        header: t("winner"),
        accessorFn: (row) => `${row.number},${row.nickName}`,
        cell: ({ row }) => <PartyLink party={row.original as PartyInfo} />,
      },
      {
        accessorKey: "paperVotes",
        header: t("paper_votes"),
        hidden: isSmall || !hasPaperVotes,
        dataType: "thousands",
      },
      {
        accessorKey: "machineVotes",
        header: t("machine_votes"),
        hidden: isSmall || !hasMachineVotes,
        dataType: "thousands",
      },
      {
        accessorKey: "totalVotes",
        headerHint: t("total_party_votes_explainer"),
        header: isXSmall ? t("votes") : t("total_votes"),
        dataType: "thousands",
      },
      {
        accessorKey: "pctVotes",
        headerHint: t("pct_party_votes_explainer"),
        header: "%",
        dataType: "percent",
      },
      /* {
        accessorKey: "prevTotalVotes",
        hidden: !prevElection,
        headerHint: t("prev_election_votes_explainer"),
        header: isXSmall ? t("prior") : t("prior_elections"),
        dataType: "thousands",
      },
      {
        accessorKey: "pctPrevChange",
        hidden: !prevElection,
        className: "font-bold",
        headerHint: t("pct_prev_election_votes_explainer"),
        header: isXSmall ? `+/-` : `% ${t("change")}`,
        dataType: "pctChange",
      },
      {
        accessorKey: "adjustedPctPrevChange",
        hidden: !prevElection || !isLarge,
        className: "font-bold",
        dataType: "pctChange",
        headerHint: t("pct_adjusted_change_explainer"),
        header: t("adjusted_change"),
      }, */
    ],
    [
      t,
      visibleColumns,
      isSmall,
      hasPaperVotes,
      hasMachineVotes,
      isXSmall,
      findRegion,
      i18n.language,
      findMunicipality,
      findSettlement,
    ],
  );
  return data?.length ? (
    <div className="w-full">
      <Caption className="py-8">{title}</Caption>
      <DataTable
        title={title}
        pageSize={data.length}
        columns={columns}
        stickyColumn={true}
        data={data}
      />
    </div>
  ) : null;
}
