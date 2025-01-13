import { PartyInfo } from "@/data/dataTypes";
import { IconTabs } from "@/screens/IconTabs";
import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PartyResultsByRegion } from "./PartyResultsByRegion";
import { PartyResultsByMunicipality } from "./PartyResultsByMunicipality";
import { PartyResultsBySettlement } from "./PartyResultsBySettlement";
import { PartyResultsBySection } from "./PartyResultsBySection";

const dataViews = [
  "regions",
  "municipalities",
  "settlements",
  "sections",
] as const;
type DataViewType = (typeof dataViews)[number];

export const PartyResultsScreen: FC<{ party: PartyInfo }> = ({ party }) => {
  const { t } = useTranslation();
  return (
    <IconTabs<DataViewType>
      title={t("election_results")}
      tabs={dataViews}
      storageKey="party_results_tabs"
      className="w-28"
    >
      {(view) => {
        if (view === "regions") return <PartyResultsByRegion party={party} />;
        if (view === "municipalities")
          return <PartyResultsByMunicipality party={party} />;
        if (view === "settlements")
          return <PartyResultsBySettlement party={party} />;
        if (view === "sections") return <PartyResultsBySection party={party} />;
      }}
    </IconTabs>
  );
};
