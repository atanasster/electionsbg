import { SectionInfo } from "@/data/dataTypes";
import { calcRecountOriginal } from "./calc_original";

export const recountSection = ({
  sectionsOriginal,
  section,
}: {
  sectionsOriginal: SectionInfo[];
  section: SectionInfo;
}) => {
  const original = sectionsOriginal.find((b) => b.section === section.section);
  if (!original) {
    throw new Error("Could not find original section: " + section.section);
  }
  const calc = calcRecountOriginal({
    originalVotes: original.results.votes,
    recountVotes: section.results.votes,
  });
  if (calc) {
    section.original = calc;
  }
};
