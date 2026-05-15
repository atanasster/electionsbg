// Parliament-term derivation shared by every governance pillar (budget,
// procurement, the Governance dashboard headline strip). A term runs from
// its opening election to the next election; the current term is open-ended
// (termEnd = null).
//
// The hook reads the selected election from ElectionContext so the existing
// global ElectionsSelect picker controls which term governance screens scope
// to — the same affordance budget and procurement have always used.

import { useMemo } from "react";
import { useElectionContext } from "@/data/ElectionContext";

// "2024_10_27" → Date. Returns null for anything that isn't a date name.
export const parseElectionDate = (name: string): Date | null => {
  const m = name.match(/^(\d{4})_(\d{2})_(\d{2})$/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}`);
};

export interface ParliamentTerm {
  // The selected election name that opened this term ("2024_10_27").
  election: string;
  termStart: Date | null;
  // null for the current (newest) parliament — open-ended.
  termEnd: Date | null;
  // The election that closed this term, if any.
  nextElection: string | null;
}

export const useParliamentTerm = (): ParliamentTerm => {
  const { selected, elections } = useElectionContext();
  return useMemo(() => {
    const idx = elections.indexOf(selected);
    const start = parseElectionDate(selected);
    // elections is newest-first, so the entry *before* `selected` is the
    // next (newer) election — the end of this term.
    const next = idx > 0 ? elections[idx - 1] : null;
    const end = next ? parseElectionDate(next) : null;
    return {
      election: selected,
      termStart: start,
      termEnd: end,
      nextElection: next,
    };
  }, [selected, elections]);
};
