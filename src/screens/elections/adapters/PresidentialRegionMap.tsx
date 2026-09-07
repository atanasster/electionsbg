// The presidential REGION map, as a shell adapter — the oblast's municipalities, filled by the
// leading ticket in the round its canvas is about.
//
// ⚠ THE ROUND COMES FROM THE SLOT, NEVER FROM THE PAGE. The shell mounts one canvas per ballot
// and a presidential place artifact carries two — round 1 and the runoff — each with its own
// map. `round` defaults to 1 only because a `ElectionSurfaceBallot` may omit it; every
// presidential ballot states it (the producer's "ONE SURFACE PER PLACE, ONE BALLOT PER ROUND,
// each stating its own `round`" rule).
//
// See `PresidentialChildMap` for the data cost and why it is bounded by `bucket_gzip.ts`.

import { FC } from "react";
import { PresidentialChildMap } from "@/screens/presidential/PresidentialChildMap";
import type { ElectionMapAdapterProps } from "../electionMapSlots";

const PresidentialRegionMap: FC<ElectionMapAdapterProps> = ({
  cycle,
  placeId,
  round,
}) => (
  <PresidentialChildMap
    cycle={cycle}
    round={round === 2 ? 2 : 1}
    parentId={placeId}
    grain="municipality"
  />
);

export default PresidentialRegionMap;
