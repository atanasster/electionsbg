import { ElectionResults, SectionInfo, VoteResults } from "../dataTypes";
import { addRecountOriginal, addResults } from "../utils";

export const aggregateSections = (sections: SectionInfo[]): ElectionResults => {
  const agg: ElectionResults = {
    results: { votes: [], protocol: undefined } as VoteResults,
  };
  sections.forEach((s) => {
    if (s.results) {
      addResults(agg.results, s.results.votes, s.results.protocol);
    }
    if (s.original) {
      addRecountOriginal({ dest: agg, src: s.original });
    }
  });
  return agg;
};
