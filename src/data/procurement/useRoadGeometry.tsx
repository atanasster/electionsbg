// BG motorway-network geometry for the АПИ road dashboard hero map. Static
// GeoJSON emitted offline by scripts/procurement/ingest_osm_roads.ts (OSM, ODbL)
// — motorway LineStrings tagged with the corridor name, BG-clipped.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface RoadFeature {
  type: "Feature";
  properties: {
    ref: string;
    corridor: string;
    class?: "АМ" | "I" | "II" | "III";
  };
  geometry: { type: "LineString"; coordinates: [number, number][] };
}
export interface RoadGeometry {
  type: "FeatureCollection";
  attribution?: string;
  features: RoadFeature[];
}

export const useRoadGeometry = () =>
  useQuery({
    queryKey: ["procurement", "roads_geo"] as const,
    queryFn: async (): Promise<RoadGeometry | null> => {
      const r = await fetch(dataUrl("/procurement/roads.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return (await r.json()) as RoadGeometry;
    },
    staleTime: Infinity,
  });
