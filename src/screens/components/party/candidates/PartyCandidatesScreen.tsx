import { PartyInfo } from "@/data/dataTypes";
import { IconTabs } from "@/screens/IconTabs";
import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PartyCandidatesAllRegions } from "./PartyCandidatesAllRegions";
import { PartyCandidatesByMunicipality } from "./PartyCandidatesByMunicipality";
import { PartyCandidatesBySettlement } from "./PartyCandidatesBySettlement";
import { PartyCandidatesBySection } from "./PartyCandidatesBySection";
import { PartyCandidatesSummary } from "./PartyCandidatesSummary";

const dataViews = [
  "regions",
  "municipalities",
  "settlements",
  "sections",
] as const;
type DataViewType = (typeof dataViews)[number];

export const PartyCandidatesScreen: FC<{ party?: PartyInfo }> = ({ party }) => {
  const { t } = useTranslation();
  return (
    party && (
      <>
        <PartyCandidatesSummary party={party} />
        <IconTabs<DataViewType>
          title={t("preferences")}
          tabs={dataViews}
          storageKey="party_financing_tabs"
          className="w-28"
        >
          {(view) => {
            if (view === "regions")
              return <PartyCandidatesAllRegions party={party} />;
            if (view === "municipalities")
              return <PartyCandidatesByMunicipality party={party} />;
            if (view === "settlements")
              return <PartyCandidatesBySettlement party={party} />;
            if (view === "sections")
              return <PartyCandidatesBySection party={party} />;
          }}
        </IconTabs>
      </>
    )
  );
};
