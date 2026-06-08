import { useMemo } from "react";
import Fuse from "fuse.js";
import { useSettlementsInfo } from "../settlements/useSettlements";
import { useMunicipalities } from "../municipalities/useMunicipalities";
import { useRegions } from "../regions/useRegions";
import { SEARCH_FUSE_OPTIONS } from "./searchConfig";
import type { SearchIndexType } from "./useSearchItems";

// Slim search index for the My-Area entry points (the header crosshair
// `AreaSniperButton` + the `MyAreaEntryScreen` autocomplete). Both consumers
// only ever resolve settlements ("s") and municipalities ("m") — they filter
// every result through `AREA_TYPES = {s, m}`. The full `useSearchItems` index
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
    const regionByCode = new Map(regions.map((r) => [r.oblast, r]));
    const muniByCode = new Map(municipalities.map((m) => [m.obshtina, m]));
    const searchItems: SearchIndexType[] = settlements.map((s) => {
      const muni = muniByCode.get(s.obshtina);
      const region = regionByCode.get(s.oblast);
      const parts = [muni?.name, region?.name].filter(Boolean);
      const partsEn = [muni?.name_en, region?.name_en].filter(Boolean);
      return {
        type: "s",
        key: s.ekatte,
        name: s.name,
        name_en: s.name_en,
        parentName: parts.length ? parts.join(", ") : undefined,
        parentName_en: partsEn.length ? partsEn.join(", ") : undefined,
      };
    });
    municipalities.forEach((m) => {
      const region = regionByCode.get(m.oblast);
      searchItems.push({
        type: "m",
        key: m.obshtina,
        name: m.name,
        name_en: m.name_en,
        parentName: region?.name,
        parentName_en: region?.name_en,
      });
    });
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
