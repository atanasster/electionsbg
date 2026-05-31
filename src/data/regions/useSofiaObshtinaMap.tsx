import { useQuery } from "@tanstack/react-query";
import { RegionGeoJSON } from "../../screens/components/maps/mapTypes";
import { dataUrl } from "@/data/dataUrl";

// Single-polygon outline of Столична община (the whole Sofia-city municipality),
// keyed nuts3 "SOF". The parliamentary regions_map splits Sofia into three МИР
// polygons (S23/S24/S25); the local council is city-wide (one Столичен общински
// съвет), so the council choropleth swaps those three for this one polygon.
// Source: yurukov/Bulgaria-geocoding municipalities.geojson (nuts4 SOF46),
// re-keyed to nuts3 "SOF" so the council map's existing SOF lookups apply.
const queryFn = async (): Promise<RegionGeoJSON> => {
  const response = await fetch(dataUrl("/sofia_obshtina.json"));
  const data = await response.json();
  return data;
};

export const useSofiaObshtinaMap = () => {
  const { data } = useQuery({
    queryKey: ["sofia_obshtina_map"],
    queryFn,
    staleTime: Infinity,
  });

  return data;
};
