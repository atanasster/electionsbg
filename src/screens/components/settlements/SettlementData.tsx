import { MapLayout } from "@/layout/dataview/MapLayout";
import { FC, ReactNode } from "react";
import { DataViewContainer } from "@/layout/dataview/DataViewContainer";
import { SettlementPartyTable } from "./SettlementPartyTable";
import { SettlementsMap } from "./SettlementsMap";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import { SettlementHistoryChart } from "./SettlementHistoryChart";
import { SettlementsAreasTable } from "./SettlementsAreasTable";
import { PreferencesByMunicipality } from "../preferences/PreferencesByMunicipality";
import { SettlementRecountTable } from "./SettlementRecountTable";
import { SettlementSuemgTable } from "./SettlementSuemgTable";

export const SettlementData: FC<{
  municipality: string;
  title: ReactNode;
  titleStr: string;
}> = ({ municipality, title, titleStr }) => {
  const { findMunicipality } = useMunicipalities();
  const municipalityInfo = findMunicipality(municipality);

  return (
    <DataViewContainer title={title}>
      {(view) => {
        if (view === "map" && municipalityInfo)
          return (
            <MapLayout>
              {(size, withNames) => (
                <SettlementsMap
                  municipality={municipalityInfo}
                  size={size}
                  withNames={withNames}
                />
              )}
            </MapLayout>
          );
        if (view === "table")
          return <SettlementsAreasTable municipality={municipality} />;
        if (view === "parties")
          return (
            <SettlementPartyTable
              municipality={municipality}
              title={titleStr}
            />
          );
        if (view === "recount")
          return (
            <SettlementRecountTable
              municipality={municipality}
              title={titleStr}
            />
          );
        if (view === "suemg")
          return (
            <SettlementSuemgTable
              title={titleStr}
              municipality={municipality}
            />
          );
        if (view === "chart")
          return <SettlementHistoryChart municipality={municipality} />;
        if (view === "pref.") {
          return (
            <PreferencesByMunicipality
              municipality={municipalityInfo?.obshtina}
              region={municipalityInfo?.oblast}
            />
          );
        }
      }}
    </DataViewContainer>
  );
};
