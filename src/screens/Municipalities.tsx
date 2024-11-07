import { MapLayout } from "@/layout/MapLayout";

import { municipalities } from "./data/json_types";
import { MunicipalitiesMap } from "./components/MunicipalitiesMap";
import { useSearchParams } from "react-router-dom";

export const MunicipalitiesScreen = () => {
  const [searchParams] = useSearchParams();
  const region = searchParams.get("region");
  if (!region) {
    return null;
  }
  return (
    <MapLayout title={region}>
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
