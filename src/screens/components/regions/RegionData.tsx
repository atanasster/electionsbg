import { MapLayout } from "@/layout/dataview/MapLayout";
import { FC } from "react";
import { RegionsMap } from "./RegionsMap";
import { DataViewContainer } from "@/layout/dataview/DataViewContainer";
import { RegionsPartyTable } from "./RegionsPartyTable";
import { RegionsHistoryChart } from "./RegionsHistoryChart";
import { RegionsAreasTable } from "./RegionsAreasTable";
import { PreferencesAllRegions } from "../preferences/PreferencesAllRegions";
import { RegionsRecountTable } from "./RegionsRecountTable";

export const RegionData: FC<{ title: string }> = ({ title }) => {
  return (
    <DataViewContainer title={title}>
      {(view) => {
        if (view === "map")
          return (
            <MapLayout>
              {(size, withNames) => (
                <RegionsMap size={size} withNames={withNames} />
              )}
            </MapLayout>
          );
        if (view === "table") return <RegionsAreasTable />;
        if (view === "parties") return <RegionsPartyTable title={title} />;
        if (view === "recount") return <RegionsRecountTable title={title} />;
        if (view === "pref.") return <PreferencesAllRegions />;
        if (view === "chart") return <RegionsHistoryChart />;
      }}
    </DataViewContainer>
  );
};
