// Shared hook: pick the cabinet that was in office on (or, if mid-campaign,
// immediately before) the user's selected election. Used by /indicators
// landing, /indicators/compare, and any future screen that needs to default
// to "the cabinet the user is implicitly looking at".
//
// Fallback when no cabinet brackets the election date: the cabinet whose
// start date is nearest to the election (in either direction). This handles
// pre-2005 elections and edge cases around cabinet transitions where the
// election date falls in the gap between two cabinets.

import { useMemo } from "react";
import { useElectionContext } from "@/data/ElectionContext";
import { useGovernments } from "@/data/governments/useGovernments";

// Election-name "YYYY_MM_DD" → ms epoch (UTC start of day).
const electionNameToMs = (name: string | undefined): number => {
  if (!name) return Number.NaN;
  const parts = name.split("_");
  if (parts.length !== 3) return Number.NaN;
  return Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
};

export const useDefaultCabinetForElection = (): string | null => {
  const { selected } = useElectionContext();
  const { data: governments } = useGovernments();

  return useMemo<string | null>(() => {
    if (!governments || governments.length === 0) return null;
    const electionMs = electionNameToMs(selected);
    if (Number.isNaN(electionMs)) {
      return governments[governments.length - 1].id;
    }
    const bracket = governments.find((g) => {
      const startMs = new Date(g.startDate).getTime();
      const endMs = g.endDate ? new Date(g.endDate).getTime() : Infinity;
      return startMs <= electionMs && electionMs <= endMs;
    });
    if (bracket) return bracket.id;
    // Election falls outside any cabinet window — pick the closest by start
    // delta. Covers cabinet-transition gaps and pre-data-range elections.
    let nearest: string | null = null;
    let nearestDelta = Infinity;
    for (const g of governments) {
      const startMs = new Date(g.startDate).getTime();
      const delta = Math.abs(startMs - electionMs);
      if (delta < nearestDelta) {
        nearestDelta = delta;
        nearest = g.id;
      }
    }
    return nearest;
  }, [governments, selected]);
};
