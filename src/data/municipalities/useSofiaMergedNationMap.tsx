import { useMemo } from "react";
import { MunicipalityGeoJSON } from "../../screens/components/maps/mapTypes";
import { useNationMunicipalitiesMap } from "./useNationMunicipalitiesMap";
import { useSofiaObshtinaMap } from "../regions/useSofiaObshtinaMap";

// The nation municipalities map carries Sofia city as its 24 районни shards
// (nuts4 S23xx/S24xx/S25xx). Indicators and EU-funds are published only for
// the city as a whole (the synthetic SOF00 aggregate), so those 24 shards all
// render with the same value — 24 identical polygons with internal borders.
// This returns the nation map with those shards replaced by one Столична-община
// polygon keyed nuts4 "SOF00" (the same synthetic code the data is keyed on and
// /settlement/SOF00 already resolves). Maps that DO have per-район data (none
// today) would keep the shards by using useNationMunicipalitiesMap directly.
const isSofiaDistrict = (nuts4: string): boolean =>
  /^S2[345]\d{2}$/.test(nuts4);

export const useSofiaMergedNationMap = (): MunicipalityGeoJSON | undefined => {
  const nationMap = useNationMunicipalitiesMap();
  const sofia = useSofiaObshtinaMap();
  return useMemo(() => {
    if (!nationMap) return undefined;
    const nonSofia = nationMap.features.filter(
      (f) => !isSofiaDistrict(f.properties.nuts4),
    );
    if (!sofia) return { ...nationMap, features: nonSofia };
    const sofiaFeature: MunicipalityGeoJSON["features"][number] = {
      ...sofia.features[0],
      properties: { nuts4: "SOF00", nuts3: "SOF" },
    };
    return { ...nationMap, features: [...nonSofia, sofiaFeature] };
  }, [nationMap, sofia]);
};
