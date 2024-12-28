import { MapLayout } from "@/layout/dataview/MapLayout";
import { FC } from "react";
import { RegionsMap } from "./RegionsMap";
import { DataViewContainer } from "@/layout/dataview/DataViewContainer";
import { RegionsPartyTable } from "./RegionsPartyTable";
import { RegionsHistoryChart } from "./RegionsHistoryChart";

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

        if (view === "table") return <RegionsPartyTable title={title} />;
        if (view === "chart") return <RegionsHistoryChart />;
      }}
    </DataViewContainer>
  );
};
