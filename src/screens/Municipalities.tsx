import { MapLayout } from "@/layout/MapLayout";

import { municipalities } from "./data/json_types";
import { MunicipalitiesMap } from "./components/MunicipalitiesMap";
import { useSearchParams } from "react-router-dom";
import { useSettlementsInfo } from "@/data/SettlementsContext";
import { useTranslation } from "react-i18next";

export const MunicipalitiesScreen = () => {
  const [searchParams] = useSearchParams();
  const { findRegion } = useSettlementsInfo();
  const { i18n } = useTranslation();
  const region = searchParams.get("region");
  if (!region) {
    return null;
  }
  const info = findRegion(region);
  return (
    <MapLayout
      title={(i18n.language === "bg" ? info?.name : info?.name_en) || ""}
    >
      {(size) => (
        <MunicipalitiesMap
          municipalities={municipalities}
          region={region}
          size={size}
        />
      )}
    </MapLayout>
  );
};
