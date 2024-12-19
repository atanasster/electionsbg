import { MapLayout } from "@/layout/dataview/MapLayout";
import { FC, ReactNode } from "react";
import { DataViewContainer } from "@/layout/dataview/DataViewContainer";
import { useDataViewContext } from "@/layout/dataview/DataViewContext";
import { SettlementPartyTable } from "./SettlementPartyTable";
import { SettlementsMap } from "./SettlementsMap";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";

export const SettlementData: FC<{ municipality: string; title: ReactNode }> = ({
  municipality,
  title,
}) => {
  const { view } = useDataViewContext();
  const { findMunicipality } = useMunicipalities();
  const municipalityInfo = findMunicipality(municipality);

  return (
    <DataViewContainer title={title}>
      {view === "map" && municipalityInfo && (
        <MapLayout>
          {(size, withNames) => (
            <SettlementsMap
              municipality={municipalityInfo}
              size={size}
              withNames={withNames}
            />
          )}
        </MapLayout>
      )}
      {view === "table" && <SettlementPartyTable municipality={municipality} />}
    </DataViewContainer>
  );
};
