import { createContext, useContext, useEffect, useState } from "react";
import { SettlementInfo } from "./SettlementsContext";

type SectionInfo = {
  section: string;
  region: number;
  region_name: string;
  zip_code: number;
  settlement: string;
  address: string;
  m_1: number;
  m_2: number;
  m_3: number;
};

type PartyInfo = {
  number: number;
  party: string;
};
type ElectionsContextType = {
  sections: SectionInfo[];
  parties: PartyInfo[];
};

export const ElectionsContext = createContext<ElectionsContextType>({
  sections: [],
  parties: [],
});

export const ElectionsContextProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [parties, setParties] = useState<PartyInfo[]>([]);

  useEffect(() => {
    fetch("/2024_10/election_sections.json")
      .then((response) => response.json())
      .then((data) => {
        setSections(data);
      });
    fetch("/2024_10/parties.json")
      .then((response) => response.json())
      .then((data) => {
        setParties(data);
      });
  }, []);
  return (
    <ElectionsContext.Provider
      value={{
        sections,
        parties,
      }}
    >
      {children}
    </ElectionsContext.Provider>
  );
};

export const useElectionInfo = () => {
  const { sections, parties } = useContext(ElectionsContext);
  const findSections = (
    region: string,
    municipality: string,
    settlement: SettlementInfo,
  ) => {
    const settlementCode = `${region}${municipality}${settlement.num}`;

    return sections.filter((s) => {
      const section = s.section.toString();
      try {
        if (section.substring(5, 7) === "00") {
          return (
            section.substring(0, 4) === settlementCode.substring(0, 4) &&
            s.settlement === settlement.t_v_m + settlement.name
          );
        } else {
          return section.toString().substring(0, 6) === settlementCode;
        }
      } catch (e) {
        console.error(e);
      }
      return false;
    });
  };

  return { findSections, parties };
};
