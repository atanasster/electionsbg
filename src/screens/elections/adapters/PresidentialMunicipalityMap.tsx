// The presidential MUNICÍPIO map, as a shell adapter — the município's settlements, filled by
// the leading ticket in the round its canvas is about.
//
// ⚠⚠ THIS IS THE EXPENSIVE ONE. It colours a handful of settlements out of a roll-up that
// covers all 4,184 in the country: 14.63 MB raw, 346 KB gzipped. It is servable only because
// `scripts/bucket_gzip.ts` carries the presidential `tur*/` roll-ups — check that before
// assuming this page is cheap, and unregister this adapter rather than ship 14.6 MB if the
// gzip list ever drops them. The proper fix is sharding the roll-up per parent, which is a
// coverage decision with its own object-count arithmetic (see `electionMapSlots.ts`).
//
// See `PresidentialChildMap` for the measurements and the round rule.

import { FC } from "react";
import { PresidentialChildMap } from "@/screens/presidential/PresidentialChildMap";
import type { ElectionMapAdapterProps } from "../electionMapSlots";

const PresidentialMunicipalityMap: FC<ElectionMapAdapterProps> = ({
  cycle,
  placeId,
  round,
}) => (
  <PresidentialChildMap
    cycle={cycle}
    round={round === 2 ? 2 : 1}
    parentId={placeId}
    grain="settlement"
  />
);

export default PresidentialMunicipalityMap;
