import { MapLayout } from "@/layout/dataview/MapLayout";
import { FC } from "react";
import { MunicipalitiesMap } from "./MunicipalitiesMap";
import { DataViewContainer } from "@/layout/dataview/DataViewContainer";
import { MunicipalityPartyTable } from "./MunicipalityPartyTable";
import { MunicipalityHistoryChart } from "./MunicipalityHistoryChart";
import { MunicipalitiesAreasTable } from "./MunicipalitiesAreasTable";
import { PreferencesByRegion } from "../preferences/PreferencesByRegion";
import { MunicipalityRecountTable } from "./MunicipalityRecountTable";
import { MunicipalitySuemgTable } from "./MunicipalitySuemgTable";

export const MunicipalityData: FC<{ region: string; title: string }> = ({
  region,
  title,
}) => {
  return (
    <DataViewContainer title={title}>
      {(view) => {
        if (view === "map") {
          return (
            <MapLayout>
              {(size) => <MunicipalitiesMap region={region} size={size} />}
            </MapLayout>
          );
        }
        if (view === "table")
          return <MunicipalitiesAreasTable region={region} />;
        if (view === "parties")
          return <MunicipalityPartyTable region={region} title={title} />;
        if (view === "recount")
          return <MunicipalityRecountTable region={region} title={title} />;
        if (view === "suemg")
          return <MunicipalitySuemgTable region={region} title={title} />;
        if (view === "pref.") return <PreferencesByRegion region={region} />;
        if (view === "chart")
          return <MunicipalityHistoryChart region={region} />;
      }}
    </DataViewContainer>
  );
};
