import { PartyInfo, PreferencesInfo } from "@/data/dataTypes";
import { DataTable } from "@/ux/data_table/DataTable";
import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMediaQueryMatch } from "@/ux/useMediaQueryMatch";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { PartyLink } from "../party/PartyLink";
import { useCandidates } from "@/data/preferences/useCandidates";
import { useRegions } from "@/data/regions/useRegions";
import { Caption } from "@/ux/Caption";
import { capitalizeFirstLetter, localDate, pctChange } from "@/data/utils";
import { CandidateLink } from "../candidates/CandidateLink";
import { SettlementLink } from "../settlements/SettlementLink";
import { MunicipalityLink } from "../municipalities/MunicipalityLink";
import { SectionLink } from "../sections/SectionLink";
import { useSettlementsInfo } from "@/data/settlements/useSettlements";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { RegionLink } from "../regions/RegionLink";
import { useElectionContext } from "@/data/ElectionContext";

type DataType = PreferencesInfo & PartyInfo & { candidateName?: string };

export type ColumnNames =
  | "ekatte"
  | "section"
  | "obshtina"
  | "oblast"
  | "candidate";
export const PreferencesTable: FC<{
  preferences: PreferencesInfo[];
  region: string;
  regionPrefs?: Record<string, PreferencesInfo[]> | null;
  visibleColumns?: ColumnNames[];
}> = ({ preferences, region, regionPrefs, visibleColumns = [] }) => {
  const { t, i18n } = useTranslation();
  const { findParty } = usePartyInfo();
  const { findCandidate } = useCandidates();
  const { findRegion } = useRegions();
  const { priorElections } = useElectionContext();
  const isMedium = useMediaQueryMatch("md");
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  const { data, hasPrevYear } = useMemo(() => {
    const allPreferences = !regionPrefs
      ? preferences.reduce((acc: Record<number, number>, curr) => {
          if (acc[curr.partyNum] === undefined) {
            acc[curr.partyNum] = 0;
          }
          acc[curr.partyNum] = acc[curr.partyNum] + curr.totalVotes;
          return acc;
        }, {})
      : undefined;
    let hasPrevYear: boolean = false;
    const data: DataType[] = preferences
      .map((preference) => {
        const party = findParty(preference.partyNum);
        const candidate = findCandidate(
          preference.oblast || region,
          preference.partyNum,
          preference.pref,
        );
        const partyPreferences = preference.partyPrefs
          ? preference.partyPrefs
          : regionPrefs && preference.oblast
            ? regionPrefs[preference.oblast]
                .filter((p) => p.partyNum === preference.partyNum)
                .reduce((acc, curr) => acc + curr.totalVotes, 0)
            : allPreferences?.[preference.partyNum];
        const pctPref = partyPreferences
          ? (100 * preference.totalVotes) / partyPreferences
          : undefined;
        const pctPrefVotes = preference.partyVotes
          ? (100 * preference.totalVotes) / preference.partyVotes
          : undefined;
        const pctPrefAllVotes = preference.allVotes
          ? (100 * preference.totalVotes) / preference.allVotes
          : undefined;
        if (preference.lyTotalVotes) {
          hasPrevYear = true;
        }
        const pctLyPreferences = preference.lyTotalVotes
          ? pctChange(preference.totalVotes, preference.lyTotalVotes)
          : undefined;
        return {
          ...preference,
          pctPref,
          pctPrefVotes,
          pctPrefAllVotes,
          pctLyPreferences,
          ...party,
          candidateName: candidate?.name,
        };
      })
      .sort((a, b) => b.totalVotes - a.totalVotes);
    return { data, hasPrevYear };
  }, [findCandidate, findParty, preferences, region, regionPrefs]);
  const hasMachinePaperVotes = useMemo(
    () => !!data.find((v) => v.paperVotes || v.machineVotes),
    [data],
  );

  return (
    <div className="w-full">
      <Caption className="py-8">{t("preferences")}</Caption>
      <DataTable<DataType, unknown>
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
            hidden: !visibleColumns.includes("oblast"),
            cellValue: ({ row }) => {
              const region = findRegion(row.getValue("oblast"));
              return i18n.language === "bg"
                ? region?.long_name || region?.name
                : region?.long_name_en || region?.name_en;
            },
            cell: ({ row }) => <RegionLink oblast={row.original.oblast} />,
          },
          {
            accessorKey: "obshtina",
            hidden: !visibleColumns.includes("obshtina"),
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
            accessorKey: "pref",
            header: "#",
            hidden: !visibleColumns.includes("candidate"),
            dataType: "thousands",
          },
          {
            accessorKey: "candidateName",
            header: t("candidate"),
            hidden: !visibleColumns.includes("candidate"),
            cell: ({ row }) =>
              row.original.candidateName && (
                <CandidateLink name={row.original.candidateName} />
              ),
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
            header: `% ${t("party")}`,
            dataType: "percent",
          },
          {
            accessorKey: "pctPrefAllVotes",
            headerHint: t("pct_pref_all_votes_explainer"),
            header: `% ${t("total")}`,
            dataType: "percent",
          },
          {
            accessorKey: "pctLyPreferences",
            hidden: !hasPrevYear || !priorElections,
            headerHint: t("pct_pref_all_votes_explainer"),
            header: priorElections ? localDate(priorElections?.name) : "+/-",
            dataType: "pctChange",
          },
        ]}
        data={data}
      />
    </div>
  );
};
