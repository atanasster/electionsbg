import { ElectionInfo, PartyInfo, PreferencesInfo } from "@/data/dataTypes";
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
import { capitalizeFirstLetter } from "@/data/utils";

export const PreferencesTable: FC<{
  preferences: PreferencesInfo[];
  region: string;
  stats?: ElectionInfo;
}> = ({ preferences, region, stats }) => {
  const { t, i18n } = useTranslation();
  const { findParty } = usePartyInfo();
  const { findCandidate } = useCandidates();
  const { findRegion } = useRegions();
  const isMedium = useMediaQueryMatch("md");

  const data = useMemo(() => {
    const allPreferences = preferences.reduce(
      (acc: Record<number, number>, curr) => {
        if (acc[curr.partyNum] === undefined) {
          acc[curr.partyNum] = 0;
        }
        acc[curr.partyNum] = acc[curr.partyNum] + curr.totalVotes;
        return acc;
      },
      {},
    );

    return preferences
      .map((preference) => {
        const party = findParty(preference.partyNum);
        const partyVotes = stats?.results?.votes.find(
          (v) => v.number === preference.partyNum,
        );
        const candidate = findCandidate(
          preference.oblast || region,
          preference.partyNum,
          preference.pref,
        );

        const partyPreferences = allPreferences[preference.partyNum];
        const pctPref = partyPreferences
          ? (100 * preference.totalVotes) / partyPreferences
          : undefined;
        const pctPrefVotes = partyVotes
          ? (100 * preference.totalVotes) / partyVotes.totalVotes
          : undefined;
        return {
          ...preference,
          pctPref,
          pctPrefVotes,
          ...party,
          candidateName: candidate?.name,
        };
      })
      .sort((a, b) => b.totalVotes - a.totalVotes);
  }, [findCandidate, findParty, preferences, region, stats?.results?.votes]);
  const hasMachinePaperVotes = useMemo(
    () => !!data.find((v) => v.paperVotes || v.machineVotes),
    [data],
  );

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
              return i18n.language === "bg"
                ? region?.long_name || region?.name
                : region?.long_name_en || region?.name_en;
            },
            cell: ({ row }) => {
              const region = findRegion(row.getValue("oblast"));
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
            accessorKey: "pref",
            header: "#",
            dataType: "thousands",
          },
          {
            accessorKey: "candidateName",
            header: t("candidate"),
          },
          {
            accessorKey: "paperVotes",
            hidden: !isMedium || !hasMachinePaperVotes,
            header: t("paper_votes"),
            dataType: "thousands",
          },
          {
            accessorKey: "machineVotes",
            hidden: !isMedium || !hasMachinePaperVotes,
            header: t("machine_votes"),
            dataType: "thousands",
          },
          {
            accessorKey: "totalVotes",
            header: capitalizeFirstLetter(t("pref.")),
            headerHint: t("total_preferences_explainer"),
            dataType: "thousands",
          },
          {
            accessorKey: "pctPref",
            headerHint: t("pct_pref_explainer"),
            header: `% ${capitalizeFirstLetter(t("pref."))}`,
            dataType: "percent",
          },
          {
            accessorKey: "pctPrefVotes",
            headerHint: t("pct_pref_votes_explainer"),
            header: `% ${t("votes")}`,
            dataType: "percent",
          },
        ]}
        data={data}
      />
    </div>
  );
};
