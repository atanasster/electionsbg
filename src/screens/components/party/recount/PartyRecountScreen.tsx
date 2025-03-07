import { PartyInfo } from "@/data/dataTypes";
import { IconTabs } from "@/screens/IconTabs";
import { FC } from "react";
import { useTranslation } from "react-i18next";
import { PartyRecountByRegion } from "./PartyRecountByRegion";
import { PartyRecountByMunicipality } from "./PartyRecountByMunicipality";
import { PartyRecountBySettlement } from "./PartyRecountBySettlement";
import { PartyRecountBySection } from "./PartyRecountBySection";
import { PartyRecountSummary } from "./PartyRecountSummary";

const dataViews = [
  "regions",
  "municipalities",
  "settlements",
  "sections",
] as const;
type DataViewType = (typeof dataViews)[number];

export const PartyRecountScreen: FC<{ party: PartyInfo }> = ({ party }) => {
  const { t } = useTranslation();

  return (
    <>
      <PartyRecountSummary party={party} />

      <IconTabs<DataViewType>
        title={t("votes_recount")}
        tabs={dataViews}
        storageKey="party_recount_tabs"
        className="w-28"
      >
        {(view) => {
          if (view === "regions") return <PartyRecountByRegion party={party} />;
          if (view === "municipalities")
            return <PartyRecountByMunicipality party={party} />;
          if (view === "settlements")
            return <PartyRecountBySettlement party={party} />;
          if (view === "sections")
            return <PartyRecountBySection party={party} />;
        }}
      </IconTabs>
    </>
  );
};
