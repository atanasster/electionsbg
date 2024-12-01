import regionsMap from "../data/json/regions_map.json";
import { RegionGeoJSON } from "./mapTypes";

const regions = regionsMap as RegionGeoJSON;
export const useRegionsMap = (): { regions: RegionGeoJSON } => {
  return {
    regions,
  };
};
