// The parliamentary region map — and the abroad one, which is the SAME adapter (§Phase 4 item 6).
//
// ⚠ ONE MODULE, TWO LEVELS, and that is the plan's own instruction: "Abroad uses the
// parliamentary region adapter". `MunicipalitiesMap` already branches internally — МИР 32 loads
// `/maps/regions/32.json`, whose features are CONTINENTS rather than municipalities, and Sofia's
// three МИР load their районы. A second adapter would be a second copy of that branching, and
// the descriptor's own comment warns that abroad's `grain: "municipality"` is the DATA grain and
// not the geography, so selecting an adapter by grain alone is the mistake to avoid.
//
// ⚠ `placeId` COMES FROM THE SURFACE, not from `useParams`. On a page rendering two surfaces —
// §4.1's expected case — a router read would draw a different place from the ranked list beside
// it, and both halves would look right.
//
// `selection: "adapter"` and no `StatCard`, for the reasons the country adapter records.

import { FC } from "react";
import { MunicipalitiesMap } from "@/screens/components/municipalities/MunicipalitiesMap";
import { MeasuredMapBox } from "@/screens/components/maps/MeasuredMapBox";
import type { ElectionMapAdapterProps } from "../electionMapSlots";

const ParliamentaryRegionMap: FC<ElectionMapAdapterProps> = ({ placeId }) => (
  <MeasuredMapBox>
    {(size) => <MunicipalitiesMap region={placeId} size={size} />}
  </MeasuredMapBox>
);

export default ParliamentaryRegionMap;
