import { IconTabs } from "@/screens/IconTabs";
import { Title } from "@/ux/Title";
import { FC, ReactNode } from "react";
import { Vote } from "lucide-react";
import { CandidateByMunicipalities } from "./CandidateByMunicipalities";
import { CandidateBySections } from "./CandidateBySections";
import { CandidateBySettlements } from "./CandidateBySettlements";
import { CandidateByRegions } from "./CandidateByRegions";

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
  return (
    <div className="w-full">
      <Title>{name}</Title>
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
