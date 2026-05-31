import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useRegions } from "@/data/regions/useRegions";
import { RegionDashboardCards } from "./dashboard/RegionDashboardCards";
import { ToLocalLink } from "@/screens/components/CrossElectionLink";

export const MunicipalitiesScreen = () => {
  const { id: region } = useParams();
  const { findRegion } = useRegions();
  const { i18n } = useTranslation();
  if (!region) {
    return null;
  }
  const info = findRegion(region);
  const title =
    (i18n.language === "bg"
      ? info?.long_name || info?.name
      : info?.long_name_en || info?.name_en) || "";
  // RegionDashboardCards is diaspora-aware: for МИР 32 (abroad) it swaps the
  // municipality map for the per-country tile and appends a voting-abroad FAQ,
  // while the municipality/census/local-government sections self-hide.
  return (
    <>
      <Title description="Interactive map of a municipality in the elections in Bulgaria">
        {title}
      </Title>
      <div className="-mt-4 mb-6 flex justify-center">
        <ToLocalLink level="region" oblast={region} />
      </div>
      <RegionDashboardCards regionCode={region} />
    </>
  );
};
