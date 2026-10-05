// The parliamentary surface for one município, as `/settlement/:obshtina` renders it — built from
// the município votes shard of the SELECTED parliamentary cycle (the level is `canonical`, so
// there is no artifact to fetch).
//
// ⚠ ONE BUILDER FOR EVERY READER. The parliamentary município page renders it, and the
// presidential município page reads its winner for the „Това място накратко" digest. Two copies
// of this call is how a digest ends up naming a different winner from the tab one click away.

import { useMemo } from "react";
import { useElectionContext } from "@/data/ElectionContext";
import { useMunicipalityVotes } from "@/data/municipalities/useMunicipalityVotes";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { useLatestLocalCycle } from "@/data/local/useLatestLocalCycle";
import { buildPartyIndex } from "./partyIndex";
import { parliamentaryMunicipalitySurface } from "./canonicalSurface";

/** @param muniCode - The obshtina code; `undefined` builds nothing (and fetches nothing). */
export const useParliamentaryMunicipalitySurface = (muniCode?: string) => {
  const { selected } = useElectionContext();
  const { municipality } = useMunicipalityVotes(muniCode);
  const { data: canonicalParties } = useCanonicalParties();
  const localCycle = useLatestLocalCycle();
  const partyIndex = useMemo(
    () => (canonicalParties ? buildPartyIndex(canonicalParties.parties) : null),
    [canonicalParties],
  );
  return useMemo(
    () =>
      municipality?.results?.votes && muniCode
        ? parliamentaryMunicipalitySurface({
            obshtina: muniCode,
            cycle: selected,
            votes: municipality.results.votes,
            protocol: municipality.results.protocol,
            partyIndex,
            localCycle,
            inLocalCycle: true,
          })
        : undefined,
    [municipality, muniCode, selected, partyIndex, localCycle],
  );
};
