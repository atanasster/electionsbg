import { PartyVotes, SectionInfo } from "@/data/dataTypes";
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
import { usePartyInfo } from "@/data/usePartyInfo";

export const SectionsList: FC<{ sections: SectionInfo[] }> = ({ sections }) => {
  const { t } = useTranslation();
  const { topVotesParty } = usePartyInfo();
  const isSmall = useMediaQueryMatch("sm");
  const data = useMemo(() => {
    return sections.map((section) => {
      const settlementName = section.settlement
        .replace(/\s+/g, "")
        .toLowerCase()
        .split(",")[0];
      const addressName = (section.address || "")
        .replace(/\s+/g, "")
        .toLowerCase();
      const cityIdx = addressName.indexOf(settlementName);
      let address = section.address;
      if (cityIdx >= 0) {
        const numSpaces =
          (section.address?.slice(0, cityIdx).split(" ").length || 1) - 1;
        address =
          section.address?.slice(
            cityIdx + settlementName.length + numSpaces + 1,
          ) || "";
      }
      const topParty = topVotesParty(section.votes);
      return {
        ...section,
        address,
        partyVotes: topParty,
        voterTurnout:
          section.protocol?.totalActualVoters &&
          section.protocol?.numRegisteredVoters
            ? (100 * section.protocol?.totalActualVoters) /
              section.protocol?.numRegisteredVoters
            : 100,
      };
    });
  }, [sections, topVotesParty]);
  return (
    <DataTable<
      SectionInfo & { partyVotes?: PartyVotes } & { voterTurnout: number },
      unknown
    >
      pageSize={25}
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
          header: t("settlement"),
        },
        {
          accessorKey: "address",
          header: t("address"),
        },

        {
          accessorKey: "voterTurnout",
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
          header: () => (
            <Hint text={t("num_paper_ballots_found_explainer")}>
              <div>{t("paper_votes")}</div>
            </Hint>
          ),
          cell: ({ row }) => {
            return (
              <div className="px-4 py-2 text-right">
                {formatThousands(row.original.protocol?.numValidVotes)}
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
                {formatThousands(row.original.protocol?.numValidMachineVotes)}
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
                {formatThousands(row.original.protocol?.totalActualVoters)}
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
                    <PartyVotesXS votes={row.original.votes} />
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
