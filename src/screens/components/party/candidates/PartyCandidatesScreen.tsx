import { PartyInfo } from "@/data/dataTypes";
import { useElectionContext } from "@/data/ElectionContext";
import { localDate } from "@/data/utils";

import { IconTabs } from "@/screens/IconTabs";
import { FC } from "react";
import { useTranslation } from "react-i18next";
import { FilingSummary } from "../campaign_financing/FilingSummary";
import { ErrorSection } from "../../ErrorSection";
import { useFinancing } from "../campaign_financing/useFinancing";
import { PartyCandidatesAllRegions } from "./PartyCandidatesAllRegions";
import { PartyCandidatesByMunicipality } from "./PartyCandidatesByMunicipality";
import { PartyCandidatesBySettlement } from "./PartyCandidatesBySettlement";
import { PartyCandidatesBySection } from "./PartyCandidatesBySection";

const dataViews = [
  "regions",
  "municipalities",
  "settlements",
  "sections",
] as const;
type DataViewType = (typeof dataViews)[number];

export const PartyCandidatesScreen: FC<{ party?: PartyInfo }> = ({ party }) => {
  const { t } = useTranslation();
  const { financing, isError, priorFinancing } = useFinancing(party);
  const { selected } = useElectionContext();
  return party && financing ? (
    <>
      <FilingSummary
        filing={financing?.data.filing}
        priorFiling={priorFinancing?.data.filing}
        party={party}
      />
      <IconTabs<DataViewType>
        title={t("candidates")}
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
  ) : (
    isError && (
      <ErrorSection
        title={t("no_results")}
        description={`${t("no_financing_data")} ${localDate(selected)}`}
      />
    )
  );
};
