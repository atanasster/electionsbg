// The local MUNICÍPIO map, as a shell adapter — the município's polling stations, coloured by
// the leading MAYORAL candidate.
//
// ⚠ THE MAYOR BALLOT, AND THE DESCRIPTOR IS WHAT SAYS SO. `local/municipality` carries FOUR
// ballots and declares exactly ONE map slot, named `municipality_mayor` — „with four ballots at
// this level, an unnamed slot could not say whether its colours are the mayoral race or the
// council vote". So this adapter draws the mayor map and nothing else; a council station map
// exists as a tile further down the page and is a different question.
//
// ⚠ IT MOUNTS THE TILE, unlike the country adapter. That is the precedent its parliamentary
// sibling sets at this level (`ParliamentaryMunicipalityMap` mounts `SectionsMapTile` and
// `CityRayonMapTile`): below the country the maps ARE tiles, and re-framing them here would be
// the second implementation §6 rules out.
//
// ⚠ EVERY HOOK IS ALREADY IN FLIGHT ON THIS PAGE, so the map costs no fetch. React Query keys
// `useLocalSectionShard` and `useLocalMunicipality` on (cycle, obshtinaCode), and
// `LocalElectionScreen` mounts both above — so these are cache reads, not a second download of
// a shard that can reach ~2 MB in Sofia.
//
// ⚠ IT RETURNS NULL RATHER THAN AN EMPTY MAP in three states, all of them real: stations with
// no backfilled coordinates (older cycles), a cycle carrying no per-section mayor votes, and
// Sofia city — which shows район choropleths instead and would otherwise mount the same
// ~1,640-marker Leaflet layer twice on one page. `ElectionMapPanel` renders nothing in the slot
// then, and the ranked result beside it is the text equivalent §4 requires either way.

import { FC } from "react";
import { useLocalSectionShard } from "@/data/local/useLocalSectionShard";
import { useLocalMunicipality } from "@/data/local/useLocalMunicipality";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { findCityRayon } from "@/data/local/cityRayonCatalog";
import { LocalSectionsMapTile } from "@/screens/dashboard/local/LocalSectionsMapTile";
import {
  mayorSectionLegend,
  mayorVoteFieldFor,
} from "@/screens/dashboard/local/mayorSectionMap";
import type { ElectionMapAdapterProps } from "../electionMapSlots";

/** Sofia's 24 районы are `S2***`; the Пловдив/Варна ones resolve through the catalogue. */
const isSofiaRayonCode = (code: string): boolean => /^S2\d{3}$/.test(code);

const LocalMunicipalityMap: FC<ElectionMapAdapterProps> = ({
  cycle,
  placeId,
}) => {
  const { shard, hasCoords } = useLocalSectionShard(cycle, placeId);
  const { municipality } = useLocalMunicipality(placeId, cycle);
  const { colorFor } = useCanonicalParties();

  const isRayon = isSofiaRayonCode(placeId) || !!findCityRayon(placeId);
  const mayorVoteField = mayorVoteFieldFor(isRayon);
  const hasMayorVotes = !!shard?.sections.some(
    (s) => (s[mayorVoteField]?.length ?? 0) > 0,
  );

  if (!shard || !hasCoords || !hasMayorVotes) return null;
  // Столична община — see the header.
  if (placeId === "SOF") return null;

  return (
    <LocalSectionsMapTile
      shard={shard}
      cycle={cycle}
      obshtinaCode={placeId}
      metric="mayor"
      mayorLegend={mayorSectionLegend(
        municipality?.mayor.round1 ?? [],
        colorFor,
      )}
      mayorVoteField={mayorVoteField}
    />
  );
};

export default LocalMunicipalityMap;
