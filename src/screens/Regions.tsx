import { MapLayout } from "@/layout/MapLayout";
import { regions } from "./data/json_types";
import { RegionsMap } from "./components/RegionsMap";

export const RegionsScreen = () => {
  return (
    <MapLayout title={"Country"}>
      {(size) => <RegionsMap regions={regions} size={size} />}
    </MapLayout>
  );
};
