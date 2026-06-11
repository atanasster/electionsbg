import { useMemo } from "react";
import Fuse from "fuse.js";
import { useSettlementsInfo } from "../settlements/useSettlements";
import { useMunicipalities } from "../municipalities/useMunicipalities";
import { useRegions } from "../regions/useRegions";
import { buildPlaceItems } from "./placeSearchItems";
import { SEARCH_FUSE_OPTIONS } from "./searchConfig";
import type { SearchIndexType } from "./useSearchItems";

// Slim search index for the My-Area entry points (the header crosshair
// `AreaSniperButton` + the `MyAreaEntryScreen` autocomplete). Both consumers
// only ever resolve settlements ("s"), municipalities ("m") and Sofia районите
// ("d") — they filter every result through the shared `AREA_TYPES` set in
// placeSearchItems.ts. The full `useSearchItems` index
// additionally pulls candidates.json (~960 KB), parliament/index.json
// (~950 KB), the officials + roll-call-vote search indexes (~1.7 MB combined),
// sections_index.json (~740 KB) and admin_flow.json — ~4.4 MB of payload that
// these two consumers immediately discard. The crosshair lives in the header
// on every page, so wiring it to the fat index made every page (the section
// detail page included) eat that 4.4 MB on load. This index is built purely
// from settlements + municipalities (both already loaded app-wide for
// breadcrumbs) + regions (bundled JSON) — zero extra network for the pages
// that already use them.
export const useAreaSearchItems = () => {
  const { settlements } = useSettlementsInfo();
  const { municipalities } = useMunicipalities();
  const { regions } = useRegions();

  const fuse = useMemo(() => {
    if (!settlements || !municipalities) return undefined;
    // Settlements + municipalities (Sofia районите as "d"), from the shared
    // builder. The synthetic София / Столична община rows that the fat index
    // adds are intentionally OMITTED here: this slim index feeds the My-Area
    // autocompletes, and neither the city aggregate (path /sofia) nor SOF00
    // (absent from municipalities.json) is an anchorable My-Area place —
    // anchoring to one would render a raw id with no findMunicipality hit.
    const searchItems = buildPlaceItems(settlements, municipalities, regions);
    return new Fuse<SearchIndexType>(
      searchItems,
      SEARCH_FUSE_OPTIONS as ConstructorParameters<
        typeof Fuse<SearchIndexType>
      >[1],
    );
  }, [settlements, municipalities, regions]);

  const search = (searchTerm: string) => fuse?.search(searchTerm);
  return { search };
};
