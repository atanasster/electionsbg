import {
  ElectionSettlement,
  PartyInfo,
  PartyVotes,
  SectionInfo,
} from "@/data/dataTypes";
import { DataTable } from "@/ux/data_table/DataTable";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Link } from "@/ux/Link";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { PartyLink } from "../party/PartyLink";

export const SectionsList: FC<{
  sections: ElectionSettlement["sections"];
  title: string;
}> = ({ sections, title }) => {
  const { t } = useTranslation();
  const { topVotesParty } = usePartyInfo();
  const isSmall = useMediaQueryMatch("sm");
  const isMedium = useMediaQueryMatch("md");
  const data = useMemo(() => {
    return sections.map((section) => {
      const settlementName =
        section.settlement?.replace(/\s+/g, "").toLowerCase() || "";
      const addressName = (section.address || "")
        .replace(/\s+/g, "")
        .toLowerCase();
      const cityIdx = addressName.indexOf(settlementName);
      let address = section.address || section.settlement;
      if (cityIdx >= 0) {
        const numSpaces =
          (section.address?.slice(0, settlementName.length).split(" ").length ||
            1) - 1;
        address =
          section.address?.slice(
            cityIdx + settlementName.length + numSpaces + 1,
          ) || "";
      }
      const topParty = topVotesParty(section.results.votes);
      return {
        ...section,
        address,
        partyVotes: topParty,
        totalActualVoters:
          (section.results.protocol?.numValidMachineVotes || 0) +
          (section.results.protocol?.numValidVotes || 0),
        voterTurnout:
          section.results.protocol?.totalActualVoters &&
          section.results.protocol?.numRegisteredVoters
            ? (100 * section.results.protocol?.totalActualVoters) /
              section.results.protocol?.numRegisteredVoters
            : 100,
      };
    });
  }, [sections, topVotesParty]);
  const hasPaperVotes = !!data.find(
    (v) => v.results.protocol?.numPaperBallotsFound,
  );
  const hasMachineVotes = !!data.find(
    (v) => v.results.protocol?.numMachineBallots,
  );

  return (
    <DataTable<
      SectionInfo & { partyVotes?: PartyVotes } & { voterTurnout: number },
      unknown
    >
      pageSize={25}
      title={title}
      stickyColumn={true}
      columns={[
        {
          accessorKey: "section",
          header: t("section"),
          cell: ({ row }) => (
            <Link to={`/section/${row.original.section}`}>
              {row.original.section}
            </Link>
          ),
        },

        {
          accessorKey: "address",
          header: t("address"),
        },
        {
          accessorKey: "voterTurnout",
          hidden: isSmall,
          headerHint: t("pct_total_voters_explainer"),
          header: t("voter_turnout"),
          dataType: "percent",
        },
        {
          accessorKey: "results.protocol.numValidVotes",
          hidden: !isMedium || !(hasMachineVotes && hasPaperVotes),
          headerHint: t("num_paper_ballots_found_explainer"),
          header: t("paper_votes"),
          dataType: "thousands",
        },
        {
          accessorKey: "results.protocol.numValidMachineVotes",
          hidden: !isMedium || !(hasMachineVotes && hasPaperVotes),
          headerHint: t("total_machine_votes_explainer"),
          header: t("machine_votes"),
          dataType: "thousands",
        },
        {
          accessorKey: "totalActualVoters",
          headerHint: t("total_voters_explainer"),
          header: isSmall ? t("votes") : t("total_votes"),
          dataType: "thousands",
        },
        {
          accessorKey: "partyVotes.nickName",
          header: t("winner"),
          size: 70,
          cell: ({ row }) => (
            <PartyLink party={row.original.partyVotes as PartyInfo} />
          ),
        },
      ]}
      data={data}
    />
  );
};
