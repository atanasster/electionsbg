// The local REGION map, as a shell adapter — the oblast's municipalities, filled by whichever
// ballot's slot asked for it.
//
// ⚠ TWO SLOTS, ONE ADAPTER KEY, AND THE `ballot` PROP IS WHAT SEPARATES THEM. `local/region`
// declares a mayor-control map and a council-support map (§2 decision 9: separate modes with
// independent legends, because „who governs" and „who has support" are different questions),
// and both declare `defaultMode: "winner"`, so both resolve here. Without the prop this adapter
// would colour the council canvas with mayoralties.
//
// ⚠ IT WRAPS `LocalRegionChoropleth` RATHER THAN REIMPLEMENTING IT — the same map
// `LocalRegionMapTile` draws further down this page, so the two cannot disagree. See that
// component's header.
//
// ⚠ NO `StatCard`, the rule `ParliamentaryCountryMap` records: the canvas already draws the
// map's question as a heading, so the tile's own label and hint would frame it twice.

import { FC } from "react";
import { MeasuredMapBox } from "@/screens/components/maps/MeasuredMapBox";
import { LocalRegionChoropleth } from "@/screens/dashboard/local/LocalRegionChoropleth";
import type { ElectionMapAdapterProps } from "../electionMapSlots";

const LocalRegionMap: FC<ElectionMapAdapterProps> = ({
  cycle,
  ballot,
  placeId,
}) => (
  <MeasuredMapBox>
    {(size) => (
      <LocalRegionChoropleth
        size={size}
        cycle={cycle}
        oblast={placeId}
        metric={ballot === "municipality_mayor" ? "mayor" : "council"}
      />
    )}
  </MeasuredMapBox>
);

export default LocalRegionMap;
