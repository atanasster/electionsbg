// The parliamentary município map — and the two city-district cases it has to keep.
//
// ⚠ THE BRANCHING MOVED HERE, IT WAS NOT REIMPLEMENTED. `MunicipalityDashboardCards` chose
// between three maps for this slot, and the choice is real rather than cosmetic:
//
//   Пловдив / Варна city   общини с районно деление the core pipeline serves as ONE aggregate,
//                          so a settlements map is a single blob — a районы choropleth instead
//   a Пловдив/Варна район  the city is one settlement, so the район has no settlement map of
//                          its own — its polling sections as located markers
//   everything else        the settlements choropleth
//
// Relocating it keeps ONE copy. Reproducing it beside the original would be the second answer
// §6 rules out — and the two would diverge exactly on the four places nobody tests by hand.
//
// ⚠ THE SECTIONS BRANCH MOUNTS ONLY WHEN ITS LIST HAS ARRIVED. `SectionsMapTile` measures its
// container in a MOUNT-ONLY layout effect, so handing it an initially-undefined async list
// leaves the map permanently blank: the effect bails on the first null render and never
// re-fires. That is why this waits rather than rendering an empty tile.
//
// `selection: "adapter"` and no `StatCard`, for the reasons the country adapter records.

import { FC } from "react";
import { SettlementsMap } from "@/screens/components/settlements/SettlementsMap";
import { MeasuredMapBox } from "@/screens/components/maps/MeasuredMapBox";
import { CityRayonMapTile } from "@/screens/dashboard/CityRayonMapTile";
import { SectionsMapTile } from "@/screens/dashboard/SectionsMapTile";
import { useMunicipalities } from "@/data/municipalities/useMunicipalities";
import {
  hasCityRayons,
  useCityRayonSections,
} from "@/data/rayon/useCityRayons";
import { findCityRayon } from "@/data/local/cityRayonCatalog";
import type { ElectionMapAdapterProps } from "../electionMapSlots";

const ParliamentaryMunicipalityMap: FC<ElectionMapAdapterProps> = ({
  placeId,
}) => {
  const { findMunicipality } = useMunicipalities();
  const cityRayon = findCityRayon(placeId);
  // The район's OWN polling sections, so its map fits just this район rather than the parent
  // city's whole choropleth. The hook is a no-op when `cityRayon` is undefined.
  const { data: rayonSections } = useCityRayonSections(
    cityRayon?.obshtina,
    cityRayon?.code,
  );
  const info = findMunicipality(placeId);

  if (hasCityRayons(placeId))
    return <CityRayonMapTile municipalityCode={placeId} />;

  if (cityRayon)
    return rayonSections && rayonSections.length ? (
      <SectionsMapTile sections={rayonSections} />
    ) : null;

  // ⚠ NOTHING RATHER THAN AN EMPTY BOX while the catalogue is in flight or when the code
  // resolves to no município — the ranked result beside it is the text equivalent §4 requires,
  // so the canvas stays readable without this half.
  return info ? (
    <MeasuredMapBox>
      {(size) => <SettlementsMap municipality={info} size={size} />}
    </MeasuredMapBox>
  ) : null;
};

export default ParliamentaryMunicipalityMap;
