import { createContext, useContext, useEffect, useState } from "react";

export type LocationInfo = {
  oblast: string;
  ekatte: string;
  name: string;
  name_en: string;
  nuts1: string;
  nuts2: string;
  nuts3: string;
};
export type RegionInfo = LocationInfo & {
  ekatte: string;
  name: string;
  name_en: string;
  region: string;
  document: string;
  full_name_bul: string;
};

export type MunicipalityInfo = LocationInfo & {
  obshtina: string;
  category: number;
  document: number;
  full_name_bul: string;
};
export type SettlementInfo = LocationInfo & {
  t_v_m: string;
  kmetstvo: string;
  kind: number;
  category: number;
  altitude: number;
  document: 2007;
  abc: number;
  text: string;
  obshtina: string;
  oblast_name: string;
  obshtina_name: string;
};

type SettlementsContextType = {
  settlements: SettlementInfo[];
  municipalities: MunicipalityInfo[];
  regions: RegionInfo[];
};

export const SettlementsContext = createContext<SettlementsContextType>({
  settlements: [],
  municipalities: [],
  regions: [],
});

export const SettlementsContextProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [settlements, setSettlements] = useState<SettlementInfo[]>([]);
  const [municipalities, setMunicipalities] = useState<MunicipalityInfo[]>([]);
  const [regions, setRegions] = useState<RegionInfo[]>([]);

  useEffect(() => {
    fetch("/settlements.json")
      .then((response) => response.json())
      .then((data) => {
        setSettlements(data);
      });
    fetch("/municipalities.json")
      .then((response) => response.json())
      .then((data) => {
        setMunicipalities(data);
      });
    fetch("/regions.json")
      .then((response) => response.json())
      .then((data) => {
        setRegions(data);
      });
  }, []);
  return (
    <SettlementsContext.Provider
      value={{
        settlements,
        municipalities,
        regions,
      }}
    >
      {children}
    </SettlementsContext.Provider>
  );
};

export const useSettlementsInfo = () => {
  const { settlements, municipalities, regions } =
    useContext(SettlementsContext);
  const findMunicipality = (m: string) => {
    return municipalities.find((s) => s.obshtina == m);
  };
  const findSettlement = (e: string) => {
    return settlements.find((s) => s.ekatte == e);
  };
  const findRegion = (e: string) => {
    return regions.find((s) => s.oblast == e);
  };

  return { findMunicipality, findSettlement, findRegion };
};
