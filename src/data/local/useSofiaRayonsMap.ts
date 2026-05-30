// Merged GeoJSON FeatureCollection of all 24 Sofia administrative районы,
// stitched together from the three parliamentary МИР polygon files
// (data/maps/regions/S23.json, S24.json, S25.json). Each feature property
// carries `nuts4` (the S2*** district code), which is the same key local
// elections use for район shards in LocalMunicipalityBundle.districts and
// for the per-district municipality JSON.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { MunicipalityGeoJSON } from "@/screens/components/maps/mapTypes";

const PARLIAMENTARY_PARTS = ["S23", "S24", "S25"] as const;

const fetchSofiaRayons = async (): Promise<MunicipalityGeoJSON> => {
  const parts = await Promise.all(
    PARLIAMENTARY_PARTS.map(async (code) => {
      const r = await fetch(dataUrl(`/maps/regions/${code}.json`));
      if (!r.ok)
        throw new Error(`sofia rayons map fetch failed: ${r.status} ${r.url}`);
      return (await r.json()) as MunicipalityGeoJSON;
    }),
  );
  return {
    type: "FeatureCollection",
    features: parts.flatMap((p) => p.features),
  } as MunicipalityGeoJSON;
};

export const useSofiaRayonsMap = () => {
  const { data } = useQuery({
    queryKey: ["sofia_rayons_map"],
    queryFn: fetchSofiaRayons,
    staleTime: Infinity,
  });
  return data;
};
