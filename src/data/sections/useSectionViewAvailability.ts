// Which national views actually hold results for ONE polling station — the guard behind the
// section page's Парламент / Президент pills and its default-view redirect.
//
// Station codes come and go between cycles (073500021 exists in 2021 and older, not in
// 2026), so "the code has the right shape" is not "this view has data". Each answer is
// evaluated against the cycle the pill would OPEN: the selected parliamentary cycle (the pill
// carries `?elections=` along) and the latest presidential cycle.
//
// `undefined` means still loading — callers keep the pill rather than flash it out and back.

import { useSectionsVotesQuery } from "./useSectionsVotes";
import { useElectionSurface } from "@/data/elections/useElectionSurface";
import { useLatestPresidentialCycle } from "@/data/presidential/useLatestPresidentialCycle";

export type SectionViewAvailability = {
  parliamentary: boolean | undefined;
  presidential: boolean | undefined;
  presidentialCycle: string;
};

export const useSectionViewAvailability = (
  sectionCode?: string,
): SectionViewAvailability => {
  const presidentialCycle = useLatestPresidentialCycle();
  const parl = useSectionsVotesQuery(sectionCode);
  const pres = useElectionSurface({
    kind: "presidential",
    level: "section",
    cycle: presidentialCycle,
    id: sectionCode,
  });

  return {
    parliamentary: !sectionCode || parl.isPending ? undefined : !!parl.section,
    presidential:
      !sectionCode || pres.status === "loading"
        ? undefined
        : pres.status === "ready",
    presidentialCycle,
  };
};
