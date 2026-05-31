import { useMemo } from "react";
import { RegionGeoJSON } from "../../screens/components/maps/mapTypes";
import { useRegionsMap } from "./useRegionsMap";
import { useSofiaObshtinaMap } from "./useSofiaObshtinaMap";

// regions_map splits Sofia city into three parliamentary МИР polygons
// (S23/S24/S25). For non-electoral indicator maps (census, Eurostat regional)
// Sofia is a single statistical unit — all three МИР carry the same value, so
// drawing three polygons with internal borders is misleading. This returns
// regions_map with those three replaced by one Столична-община polygon keyed
// nuts3 "SOF" (the same code the census file uses and the local council map
// renders). Parliamentary maps (votes, persistence, wasted-vote) keep the
// three МИР because their data differs per МИР.
const isSofiaMir = (nuts3: string): boolean => /^S2[345]$/.test(nuts3);

export const useSofiaMergedRegionsMap = (): RegionGeoJSON | undefined => {
  const regionsMap = useRegionsMap();
  const sofia = useSofiaObshtinaMap();
  return useMemo(() => {
    if (!regionsMap) return undefined;
    const nonSofia = regionsMap.features.filter(
      (f) => !isSofiaMir(f.properties.nuts3),
    );
    if (!sofia) return { ...regionsMap, features: nonSofia };
    // sofia.features[0] is already keyed nuts3 "SOF".
    return { ...regionsMap, features: [...nonSofia, ...sofia.features] };
  }, [regionsMap, sofia]);
};
