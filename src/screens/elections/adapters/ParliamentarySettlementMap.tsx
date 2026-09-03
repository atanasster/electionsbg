// The parliamentary settlement map — its polling stations as located markers.
//
// ⚠ IT IS MARKERS, NOT A CHOROPLETH, and that is why it takes no `featureLabel`. A polling
// station has no boundary to colour; `SectionsMap` places a marker per station. `FeatureMap`'s
// keyboard opt-in is about SELECTABLE PATHS, so it does not apply here — the equivalent for a
// marker layer is a separate question this phase does not open, and the ranked result beside it
// is the text equivalent §4 requires either way.
//
// `selection: "adapter"` and no `StatCard`, for the reasons the country adapter records.

import { FC } from "react";
import { SectionsMap } from "@/screens/components/sections/SectionsMap";
import { MeasuredMapBox } from "@/screens/components/maps/MeasuredMapBox";
import { useSettlementVotes } from "@/data/settlements/useSettlementVotes";
import type { ElectionMapAdapterProps } from "../electionMapSlots";

const ParliamentarySettlementMap: FC<ElectionMapAdapterProps> = ({
  placeId,
}) => {
  const { settlement } = useSettlementVotes(placeId);
  const sections = settlement?.sections;
  // ⚠ NOTHING RATHER THAN AN EMPTY BOX. `SectionsMap` fits its bounds to the stations it is
  // given, so an empty list renders a map of nowhere.
  return sections && sections.length ? (
    <MeasuredMapBox>
      {(size) => <SectionsMap sections={sections} size={size} />}
    </MeasuredMapBox>
  ) : null;
};

export default ParliamentarySettlementMap;
