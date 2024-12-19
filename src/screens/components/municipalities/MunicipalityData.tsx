import { MapLayout } from "@/layout/dataview/MapLayout";
import { FC, ReactNode } from "react";
import { MunicipalitiesMap } from "./MunicipalitiesMap";
import { DataViewContainer } from "@/layout/dataview/DataViewContainer";
import { useDataViewContext } from "@/layout/dataview/DataViewContext";
import { MunicipalityPartyTable } from "./MunicipalityPartyTable";
import { MunicipalityHistoryChart } from "./MunicipalityHistoryChart";

export const MunicipalityData: FC<{ region: string; title: ReactNode }> = ({
  region,
  title,
}) => {
  const { view } = useDataViewContext();
  return (
    <DataViewContainer title={title}>
      {view === "map" && (
        <MapLayout>
          {(size, withNames) => (
            <MunicipalitiesMap
              region={region}
              size={size}
              withNames={withNames}
            />
          )}
        </MapLayout>
      )}
      {view === "table" && <MunicipalityPartyTable region={region} />}
      {view === "chart" && <MunicipalityHistoryChart region={region} />}
    </DataViewContainer>
  );
};
