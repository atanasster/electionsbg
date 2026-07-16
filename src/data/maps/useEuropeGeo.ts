import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Europe country geometry for EuChoroplethMap — built by
// scripts/administration/build_europe_geo.ts from Eurostat GISCO, keyed by
// `properties.geo` (Eurostat geo code). Bucket-served, cached forever.

export interface EuropeFeature {
  type: "Feature";
  properties: { geo: string };
  geometry: GeoJSON.Geometry;
}
export interface EuropeGeo {
  type: "FeatureCollection";
  features: EuropeFeature[];
}

export const useEuropeGeo = () =>
  useQuery({
    queryKey: ["maps", "europe-countries"] as const,
    queryFn: async (): Promise<EuropeGeo | undefined> => {
      const res = await fetch(dataUrl("/maps/europe/countries.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as EuropeGeo;
    },
    staleTime: Infinity,
  });
