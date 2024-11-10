import { useEffect, useState } from "react";
import { PartyInfo, SectionInfo } from "./dataTypes";
import { useAggregatedVotes } from "./AggregatedVotesHook";

export const useElectionInfo = () => {
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [parties, setParties] = useState<PartyInfo[]>([]);
  const { votesBySettlement } = useAggregatedVotes();
  useEffect(() => {
    fetch("/2024_10/sections.json")
      .then((response) => response.json())
      .then((data) => {
        setSections(data);
      });
    fetch("/2024_10/cik_parties.json")
      .then((response) => response.json())
      .then((data) => {
        setParties(data);
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
  const findParty = (partyNum: number) =>
    parties.find((p) => p.number === partyNum);
  return { findSections, findParty };
};
