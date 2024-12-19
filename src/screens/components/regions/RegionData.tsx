import { MapLayout } from "@/layout/dataview/MapLayout";
import { FC, ReactNode } from "react";
import { RegionsMap } from "./RegionsMap";
import { DataViewContainer } from "@/layout/dataview/DataViewContainer";
import { useDataViewContext } from "@/layout/dataview/DataViewContext";
import { RegionsPartyTable } from "./RegionsPartyTable";
import { RegionsHistoryChart } from "./RegionsHistoryChart";

export const RegionData: FC<{ title: ReactNode }> = ({ title }) => {
  const { view } = useDataViewContext();
  return (
    <DataViewContainer title={title}>
      {view === "map" && (
        <MapLayout>
          {(size, withNames) => (
            <RegionsMap size={size} withNames={withNames} />
          )}
        </MapLayout>
      )}
      {view === "table" && <RegionsPartyTable />}
      {view === "chart" && <RegionsHistoryChart />}
    </DataViewContainer>
  );
};
