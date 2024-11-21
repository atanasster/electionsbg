import { useEffect, useState, createContext, useContext } from "react";
import { SectionInfo } from "./dataTypes";
import { useAggregatedVotes } from "./AggregatedVotesHook";

type SectionContextType = {
  findSections: (
    region: string,
    municipality: string,
    ekatte: string,
  ) => SectionInfo[];
  findSection: (section: string) => SectionInfo | undefined;
  sections: SectionInfo[];
};
const SectionContext = createContext<SectionContextType>({
  findSections: () => [],
  findSection: () => undefined,
  sections: [],
});

export const SectionContextProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const { votesBySettlement } = useAggregatedVotes();
  useEffect(() => {
    fetch("/2024_10/sections.json")
      .then((response) => response.json())
      .then((data) => {
        setSections(data);
      });
  }, []);
  const findSections = (
    region: string,
    municipality: string,
    ekatte: string,
  ) => {
    const sectionCodes = votesBySettlement(region, municipality, ekatte);
    if (!sectionCodes) {
      return [];
    }
    return sections.filter((s) => {
      return sectionCodes.sections.includes(s.section);
    });
  };

  const findSection = (section: string) =>
    sections.find((s) => s.section === section);
  return (
    <SectionContext.Provider value={{ findSections, findSection, sections }}>
      {children}
    </SectionContext.Provider>
  );
};

export const useSectionsInfo = () => {
  const context = useContext(SectionContext);
  return context;
};
