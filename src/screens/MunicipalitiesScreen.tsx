import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Title } from "@/ux/Title";
import { useRegions } from "@/data/regions/useRegions";
import { RegionDashboardCards } from "./dashboard/RegionDashboardCards";

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
  return (
    <>
      <Title description="Interactive map of a municipality in the elections in Bulgaria">
        {title}
      </Title>
      <RegionDashboardCards regionCode={region} />
    </>
  );
};
