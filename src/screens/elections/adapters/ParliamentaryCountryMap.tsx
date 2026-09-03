// The parliamentary country map, as a shell adapter (§6, Phase 4 item 4).
//
// ⚠ IT WRAPS THE EXISTING MAP RATHER THAN REIMPLEMENTING IT. §6's rule is that
// `ElectionMapPanel` "wraps existing map tiles through typed slots rather than reimplementing
// maps": `RegionsMap` already owns the geography fetch, the shift arrows, the tooltip, Sofia's
// inset and the world link, and a second country map would be a second answer to „who led
// where" that could disagree with the one on every other election page.
//
// ⚠ IT IS `selection: "adapter"` AND THAT IS THE HONEST DECLARATION. The map fetches its own
// features and navigates on click, so the shell has no feature list to hand it and no selection
// to bind — forcing it into `selection: "shell"` would mean an empty list and a no-op
// `onSelect`, which is a lie in the type, while `presentational` would be a false a11y claim
// about a map that navigates. The `interactive` POSTURE is a real claim and is held elsewhere:
// `MapElement` passes an `ariaLabel` through `FeatureMap`'s `!!ariaLabel && !!onClick`
// derivation, and `mapKeyboard.test.tsx` measures 31 of 31 regions focusable.
//
// ⚠ NO `StatCard` WRAPPER. The canvas already draws the map's question as a heading
// (`data-map-question`); the tile's own label and hint would be a second frame around the same
// thing, which is what "wrapping through a typed slot" is meant to avoid.

import { FC } from "react";
import { RegionsMap } from "@/screens/components/regions/RegionsMap";
import { MeasuredMapBox } from "@/screens/components/maps/MeasuredMapBox";
import type { ElectionMapAdapterProps } from "../electionMapSlots";

const ParliamentaryCountryMap: FC<ElectionMapAdapterProps> = () => (
  <MeasuredMapBox>{(size) => <RegionsMap size={size} />}</MeasuredMapBox>
);

export default ParliamentaryCountryMap;
