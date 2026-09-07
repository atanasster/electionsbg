// The presidential SETTLEMENT map, as a shell adapter — the settlement's polling stations as
// markers, coloured by the leading ticket in the round its canvas is about.
//
// ⚠ MARKERS, NOT A CHOROPLETH, which is why this level needed a component of its own rather
// than another `PresidentialChildMap` grain: a polling station has no boundary to fill. Its
// parliamentary sibling makes the same split for the same reason.
//
// ⚠ IT READS AN OBLAST-SHARDED FILE, unlike the two levels above it. The section level is the
// only part of the presidential tree cut per parent, which is what makes this servable at all —
// 2.4 MB raw / 62 KB gzipped for the largest oblast, against the 14.63 MB whole-country file
// the município map has to take. `scripts/bucket_gzip.ts` carries these shards; the gate in
// `presidentialMaps.test.ts` fails if a registered level's file leaves that list.
//
// See `PresidentialSectionsMap` for the coordinate join and its measured coverage.

import { FC } from "react";
import { PresidentialSectionsMap } from "@/screens/presidential/PresidentialSectionsMap";
import type { ElectionMapAdapterProps } from "../electionMapSlots";

const PresidentialSettlementMap: FC<ElectionMapAdapterProps> = ({
  cycle,
  placeId,
  round,
}) => (
  <PresidentialSectionsMap
    cycle={cycle}
    round={round === 2 ? 2 : 1}
    ekatte={placeId}
  />
);

export default PresidentialSettlementMap;
