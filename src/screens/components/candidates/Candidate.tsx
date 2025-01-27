import { IconTabs } from "@/screens/IconTabs";
import { Title } from "@/ux/Title";
import { FC, ReactNode, useMemo } from "react";
import { Vote } from "lucide-react";
import { CandidateByMunicipalities } from "./CandidateByMunicipalities";
import { CandidateBySections } from "./CandidateBySections";
import { CandidateBySettlements } from "./CandidateBySettlements";
import { CandidateByRegions } from "./CandidateByRegions";
import { useCandidates } from "@/data/preferences/useCandidates";
import { usePartyInfo } from "@/data/parties/usePartyInfo";
import { PartyLink } from "../party/PartyLink";
import { RegionLink } from "../regions/RegionLink";

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
export const Candidate: FC<{ name: string }> = ({ name }) => {
  const { candidates } = useCandidates();
  const { findParty } = usePartyInfo();
  const candidateInfo = useMemo(
    () => candidates?.filter((c) => c.name === name),
    [candidates, name],
  );
  return (
    <div className="w-full">
      <Title>{name}</Title>
      {candidateInfo?.map((c) => {
        const party = findParty(c.partyNum);
        return (
          <div
            key={`${c.oblast}-${c.pref}`}
            className="flex justify-center py-2 "
          >
            <div className="flex gap-2 items-center">
              <PartyLink party={party}></PartyLink>
              <RegionLink oblast={c.oblast} />
              {"-"}
              <div className="font-semibold">{c.pref}</div>
            </div>
          </div>
        );
      })}

      <IconTabs<DataViewType>
        title={name}
        tabs={dataViews}
        icons={DataTypeIcons}
        storageKey="candidate_tabs"
        className="w-32"
      >
        {(view) => {
          if (view === "regions") return <CandidateByRegions name={name} />;
          if (view === "municipalities")
            return <CandidateByMunicipalities name={name} />;
          if (view === "settlements")
            return <CandidateBySettlements name={name} />;
          if (view === "sections") return <CandidateBySections name={name} />;
        }}
      </IconTabs>
    </div>
  );
};
