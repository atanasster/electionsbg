import { useEffect, useState } from "react";
import { SectionInfo } from "./dataTypes";
import { useAggregatedVotes } from "./AggregatedVotesHook";

export const useSectionsInfo = () => {
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
  return { findSections, findSection, sections };
};
