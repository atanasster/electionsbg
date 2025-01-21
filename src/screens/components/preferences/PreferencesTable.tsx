import { PartyInfo, PreferencesInfo } from "@/data/dataTypes";
import { DataTable } from "@/ux/data_table/DataTable";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { PartyLink } from "../party/PartyLink";
import { useCandidates } from "@/data/preferences/useCandidates";
import { useRegions } from "@/data/regions/useRegions";
import { Link } from "@/ux/Link";
import { Caption } from "@/ux/Caption";

export const PreferencesTable: FC<{
  preferences: PreferencesInfo[];
  region: string;
}> = ({ preferences, region }) => {
  const { t, i18n } = useTranslation();
  const { findParty } = usePartyInfo();
  const { findCandidate } = useCandidates();
  const { findRegion } = useRegions();
  const isSmall = useMediaQueryMatch("sm");
  const isMedium = useMediaQueryMatch("md");
  const data = useMemo(() => {
    return preferences
      .map((preference) => {
        const party = findParty(preference.partyNum);
        const candidate = findCandidate(
          preference.oblast || region,
          preference.partyNum,
          preference.pref,
        );
        return { ...preference, ...party, candidateName: candidate?.name };
      })
      .sort((a, b) => b.totalVotes - a.totalVotes);
  }, [findCandidate, findParty, preferences, region]);
  const hasPaperVotes = !!data.find((v) => v.paperVotes);
  const hasMachineVotes = !!data.find((v) => v.machineVotes);
  return (
    <div className="w-full">
      <Caption className="py-8">{t("preferences")}</Caption>
      <DataTable<PreferencesInfo & PartyInfo, unknown>
        pageSize={25}
        title={t("preferences")}
        stickyColumn={true}
        columns={[
          {
            accessorKey: "nickName",
            header: t("party"),
            size: 70,
            cellValue: ({ row }) => row.original.nickName,
            cell: ({ row }) => <PartyLink party={row.original as PartyInfo} />,
          },
          {
            accessorKey: "oblast",
            header: t("region"),
            hidden: region !== "",
            cellValue: ({ row }) => {
              const region = findRegion(row.getValue("oblast"));
              return i18n.language === "bg" ? region?.name : region?.name_en;
            },
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
            accessorKey: "pref",
            header: t("preference"),
          },
          {
            accessorKey: "candidateName",
            header: t("candidate"),
          },
          {
            accessorKey: "paperVotes",
            hidden: !isMedium || !(hasMachineVotes && hasPaperVotes),
            headerHint: t("num_paper_ballots_found_explainer"),
            header: t("paper_votes"),
            dataType: "thousands",
          },
          {
            accessorKey: "machineVotes",
            hidden: !isMedium || !(hasMachineVotes && hasPaperVotes),
            headerHint: t("total_machine_votes_explainer"),
            header: t("machine_votes"),
            dataType: "thousands",
          },
          {
            accessorKey: "totalVotes",
            headerHint: t("total_voters_explainer"),
            header: isSmall ? t("votes") : t("total_votes"),
            dataType: "thousands",
          },
        ]}
        data={data}
      />
    </div>
  );
};
