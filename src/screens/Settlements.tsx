import { MapLayout } from "@/layout/MapLayout";

import { settlements } from "./data/json_types";
import { SettlementsMap } from "./components/SettlementsMap";
import { useSearchParams } from "react-router-dom";

export const SettlementsScreen = () => {
  const [searchParams] = useSearchParams();
  const region = searchParams.get("region");
  const settlement = searchParams.get("settlement");
  if (!region || !settlement) {
    return null;
  }
  return (
    <MapLayout title={`${region}-${settlement}`}>
      {(size) => (
        <SettlementsMap
          settlements={settlements}
          settlement={settlement}
          region={region}
          size={size}
        />
      )}
    </MapLayout>
  );
};
