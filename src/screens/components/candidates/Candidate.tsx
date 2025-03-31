import { IconTabs } from "@/screens/IconTabs";
import { Title } from "@/ux/Title";
import { FC, ReactNode, useMemo } from "react";
import { Banknote, Vote } from "lucide-react";
import { CandidateByMunicipalities } from "./CandidateByMunicipalities";
import { CandidateBySections } from "./CandidateBySections";
import { CandidateBySettlements } from "./CandidateBySettlements";
import { CandidateByRegions } from "./CandidateByRegions";
import { useCandidates } from "@/data/preferences/useCandidates";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { PartyLink } from "../party/PartyLink";
import { RegionLink } from "../regions/RegionLink";
import { useElectionContext } from "@/data/ElectionContext";
import { useTranslation } from "react-i18next";
import { CandidateDonationsTable } from "./CandidateDonationsTable";

const dataViews = [
  "regions",
  "municipalities",
  "settlements",
  "sections",
] as const;
type DataViewType = (typeof dataViews)[number];

const DataTypeIcons: Record<DataViewType, ReactNode> = {
  regions: <Vote />,
  municipalities: <Vote />,
  settlements: <Vote />,
  sections: <Vote />,
};

const tabViews = ["results", "donations"] as const;
type TabViewType = (typeof tabViews)[number];

const TabTypeIcons: Record<TabViewType, ReactNode> = {
  results: <Vote />,
  donations: <Banknote />,
};

export const Candidate: FC<{ name: string }> = ({ name }) => {
  const { candidates } = useCandidates();
  const { findParty } = usePartyInfo();
  const { electionStats } = useElectionContext();
  const candidateInfo = useMemo(
    () => candidates?.filter((c) => c.name === name),
    [candidates, name],
  );
  const { t } = useTranslation();
  const excluded: { exclude: TabViewType[]; replace: TabViewType } = {
    exclude: [],
    replace: "results",
  };
  if (!electionStats?.hasFinancials) {
    excluded.exclude.push("donations");
  }

  return (
    <div className="w-full">
      <Title
        description={`Results for party candidate ${name}`}
        className="md:pb-8"
      >
        {name}
      </Title>
      <table className="flex justify-center py-2 ">
        <tbody>
          {candidateInfo?.map((c) => {
            const party = findParty(c.partyNum);
            return (
              <tr key={`${c.oblast}-${c.pref}`}>
                <td>
                  <div className="my-1">
                    <PartyLink party={party} width="w-14"></PartyLink>
                  </div>
                </td>
                <td>
                  <div className="text-lg  px-2 font-semibold">
                    <RegionLink oblast={c.oblast} />
                  </div>
                </td>
                <td>
                  <div className="text-lg  px-2 font-semibold">{`#${c.pref}`}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <IconTabs<TabViewType>
        title={name}
        tabs={tabViews}
        icons={TabTypeIcons}
        storageKey="candidate_tabs"
        excluded={excluded}
        className="w-28"
      >
        {(view) => {
          if (view === "donations") {
            return <CandidateDonationsTable name={name} />;
          }
          if (view === "results")
            return (
              <IconTabs<DataViewType>
                title={t("results")}
                tabs={dataViews}
                icons={DataTypeIcons}
                storageKey="candidate_results_tabs"
                className="w-32"
              >
                {(view) => {
                  if (view === "regions")
                    return <CandidateByRegions name={name} />;
                  if (view === "municipalities")
                    return <CandidateByMunicipalities name={name} />;
                  if (view === "settlements")
                    return <CandidateBySettlements name={name} />;
                  if (view === "sections")
                    return <CandidateBySections name={name} />;
                }}
              </IconTabs>
            );
        }}
      </IconTabs>
    </div>
  );
};
