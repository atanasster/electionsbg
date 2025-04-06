import { PartyInfo, PreferencesInfo } from "@/data/dataTypes";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
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

type DataType = PreferencesInfo &
  Partial<PartyInfo> & { candidateName?: string };

export type ColumnNames =
  | "party"
  | "ekatte"
  | "section"
  | "obshtina"
  | "oblast"
  | "candidate";
export const PreferencesTable: FC<{
  preferences: PreferencesInfo[];
  region?: string;
  regionPrefs?: Record<string, PreferencesInfo[]> | null;
  visibleColumns?: ColumnNames[];
  hiddenColumns?: ColumnNames[];
  title?: string;
}> = ({
  preferences,
  region,
  regionPrefs,
  visibleColumns = [],
  hiddenColumns = [],
  title,
}) => {
  const { t, i18n } = useTranslation();
  const { findParty } = usePartyInfo();
  const { findCandidate } = useCandidates();
  const { findRegion } = useRegions();
  const { priorElections } = useElectionContext();
  const isMedium = useMediaQueryMatch("md");
  const { findSettlement } = useSettlementsInfo();
  const { findMunicipality } = useMunicipalities();
  const { data, hasPrevYear, hasMachinePaperVotes } = useMemo(() => {
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
    let hasMachinePaperVotes: boolean = false;
    const data: DataType[] = preferences
      .map((preference) => {
        const party = hiddenColumns.includes("party")
          ? undefined
          : findParty(preference.partyNum);
        const oblast = preference.oblast || region;
        const candidate = oblast
          ? findCandidate(oblast, preference.partyNum, preference.pref)
          : undefined;
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
        if (preference.machineVotes || preference.paperVotes) {
          hasMachinePaperVotes = true;
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
    return { data, hasPrevYear, hasMachinePaperVotes };
  }, [
    findCandidate,
    findParty,
    hiddenColumns,
    preferences,
    region,
    regionPrefs,
  ]);

  const columns: DataTableColumns<DataType, unknown> = useMemo(
    () => [
      {
        accessorKey: "nickName",
        header: t("party"),
        hidden: hiddenColumns.includes("party"),
        size: 70,
        cell: ({ row }) => <PartyLink party={row.original as PartyInfo} />,
      },
      {
        accessorKey: "oblast",
        header: t("region"),
        hidden: !visibleColumns.includes("oblast"),
        accessorFn: (row) => {
          const region = findRegion(row.oblast);
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
        accessorKey: "pref",
        header: "#",
        hidden: !visibleColumns.includes("candidate"),
      },
      {
        accessorKey: "candidateName",
        header: t("candidate"),
        hidden: !visibleColumns.includes("candidate"),
        className: "font-semibold",
        cell: ({ row }) =>
          row.original.candidateName && (
            <CandidateLink name={row.original.candidateName} />
          ),
      },
      {
        header: t("preferences"),
        colSpan: 3,
        columns: [
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
            className: "font-bold",
            header: t("total"),
            headerHint: t("total_preferences_explainer"),
            dataType: "thousands",
          },
        ],
      },
      {
        header: t("analysis"),
        colSpan: 3,
        columns: [
          {
            accessorKey: "pctPref",
            headerHint: t("pct_pref_explainer"),
            header: capitalizeFirstLetter(t("pref.")),
            dataType: "percent",
          },
          {
            accessorKey: "pctPrefVotes",
            headerHint: t("pct_pref_votes_explainer"),
            header: t("party"),
            dataType: "percent",
          },
          {
            accessorKey: "pctPrefAllVotes",
            headerHint: t("pct_pref_all_votes_explainer"),
            header: t("total"),
            dataType: "percent",
          },
        ],
      },
      {
        colSpan: 2,
        header: priorElections ? localDate(priorElections?.name) : "+/-",
        hidden: !hasPrevYear || !priorElections,
        columns: [
          {
            accessorKey: "lyTotalVotes",
            header: capitalizeFirstLetter(t("pref.")),
            dataType: "thousands",
          },
          {
            accessorKey: "pctLyPreferences",
            headerHint: t("pct_pref_all_votes_explainer"),
            header: t("change"),
            dataType: "pctChange",
          },
        ],
      },
    ],
    [
      findMunicipality,
      findRegion,
      findSettlement,
      hasMachinePaperVotes,
      hasPrevYear,
      hiddenColumns,
      i18n.language,
      isMedium,
      priorElections,
      t,
      visibleColumns,
    ],
  );
  const tableTitle = title || t("preferences");
  return (
    <div className="w-full">
      <Caption className="py-8">{tableTitle}</Caption>
      <DataTable<DataType, unknown>
        pageSize={25}
        title={tableTitle}
        stickyColumn={true}
        columns={columns}
        data={data}
      />
    </div>
  );
};
