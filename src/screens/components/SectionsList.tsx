import { ElectionSettlement, PartyVotes, SectionInfo } from "@/data/dataTypes";
import { Caption } from "@/ux/Caption";
import { DataTable } from "@/ux/DataTable";
import { Tooltip } from "@/ux/Tooltip";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PartyVotesXS } from "./PartyVotesXS";
import { Hint } from "@/ux/Hint";
import { formatPct, formatThousands } from "@/data/utils";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { Link } from "@/ux/Link";
import { usePartyInfo } from "@/data/parties/usePartyInfo";

export const SectionsList: FC<{ sections: ElectionSettlement["sections"] }> = ({
  sections,
}) => {
  const { t } = useTranslation();
  const { topVotesParty } = usePartyInfo();
  const isSmall = useMediaQueryMatch("sm");
  const isMedium = useMediaQueryMatch("md");
  const isLarge = useMediaQueryMatch("lg");
  const data = useMemo(() => {
    return sections.map((section) => {
      const settlementName =
        section.settlement?.replace(/\s+/g, "").toLowerCase() || "";
      const addressName = (section.address || "")
        .replace(/\s+/g, "")
        .toLowerCase();
      const cityIdx = addressName.indexOf(settlementName);
      let address = section.address;
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
      stickyColumn={true}
      columns={[
        {
          accessorKey: "section",
          header: t("section"),
          cell: ({ row }) => (
            <Link
              to={{
                pathname: "/section",
                search: {
                  section: row.original.section,
                },
              }}
            >
              {row.getValue("section")}
            </Link>
          ),
        },
        {
          accessorKey: "settlement",
          hidden: !isLarge,
          header: t("settlement"),
        },
        {
          accessorKey: "address",
          header: t("address"),
        },
        {
          accessorKey: "voterTurnout",
          hidden: isSmall,
          header: () => (
            <Hint text={t("pct_total_voters_explainer")}>
              <div>{t("voter_turnout")}</div>
            </Hint>
          ),
          cell: ({ row }) => {
            return (
              <div className="px-4 py-2 text-right">
                {formatPct(row.original.voterTurnout, 2)}
              </div>
            );
          },
        },
        {
          accessorKey: "partyVotes.paperVotes",
          hidden: !isMedium || !(hasMachineVotes && hasPaperVotes),
          header: () => (
            <Hint text={t("num_paper_ballots_found_explainer")}>
              <div>{t("paper_votes")}</div>
            </Hint>
          ),
          cell: ({ row }) => {
            return (
              <div className="px-4 py-2 text-right">
                {formatThousands(row.original.results.protocol?.numValidVotes)}
              </div>
            );
          },
        },
        {
          accessorKey: "partyVotes.machineVotes",
          hidden: !isMedium || !(hasMachineVotes && hasPaperVotes),
          header: () => (
            <Hint text={t("total_machine_votes_explainer")}>
              <div>{t("machine_votes")}</div>
            </Hint>
          ),
          cell: ({ row }) => {
            return (
              <div className="px-4 py-2 text-right">
                {formatThousands(
                  row.original.results.protocol?.numValidMachineVotes,
                )}
              </div>
            );
          },
        },
        {
          accessorKey: "protocol.totalActualVoters",
          header: () => (
            <Hint text={t("total_voters_explainer")}>
              <div>{isSmall ? t("votes") : t("total_votes")}</div>
            </Hint>
          ),
          cell: ({ row }) => {
            return (
              <div className="px-4 py-2 text-right">
                {formatThousands(
                  row.original.results.protocol?.totalActualVoters,
                )}
              </div>
            );
          },
        },
        {
          accessorKey: "partyVotes.key",
          header: t("winner"),
          size: 70,
          cell: ({ row }) => {
            return (
              <Tooltip
                content={
                  <div>
                    <Caption>{row.original.section}</Caption>
                    <PartyVotesXS votes={row.original.results.votes} />
                  </div>
                }
              >
                <div
                  className="text-white text-right px-2 font-bold w-24"
                  style={{
                    backgroundColor: row.original.partyVotes?.color,
                  }}
                >
                  {row.original.partyVotes?.nickName}
                </div>
              </Tooltip>
            );
          },
        },
      ]}
      data={data}
    />
  );
};
