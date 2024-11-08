import { MapLayout } from "@/layout/MapLayout";

import { settlements } from "./data/json_types";
import { SettlementsMap } from "./components/SettlementsMap";
import { useSearchParams } from "react-router-dom";
import { useSettlementsInfo } from "@/data/SettlementsContext";

export const SettlementsScreen = () => {
  const [searchParams] = useSearchParams();
  const regionCode = searchParams.get("region");
  const { findRegion, findMunicipality } = useSettlementsInfo();
  if (!regionCode) {
    return null;
  }
  const region = findRegion(regionCode);
  const muniCode = searchParams.get("municipality");
  if (!muniCode) {
    return null;
  }
  const municipality = findMunicipality(muniCode);
  if (!region || !municipality) {
    return null;
  }
  return (
    <MapLayout title={`${region.name} / ${municipality.name}`}>
      {(size) => (
        <SettlementsMap
          settlements={settlements}
          municipality={municipality}
          region={region}
          size={size}
        />
      )}
    </MapLayout>
  );
};
