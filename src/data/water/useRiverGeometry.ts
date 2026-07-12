// Major-river geometry for the /water flood-maintenance choropleth's decorative
// "river spine". Static GeoJSON emitted offline by
// scripts/water/ingest_osm_rivers.ts (OSM, ODbL) — major-river LineStrings
// tagged with the river name, BG-clipped. Context only, not coloured by spend.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface RiverFeature {
  type: "Feature";
  properties: { name: string };
  geometry: { type: "LineString"; coordinates: [number, number][] };
}
export interface RiverGeometry {
  type: "FeatureCollection";
  attribution?: string;
  features: RiverFeature[];
}

export const useRiverGeometry = () =>
  useQuery({
    queryKey: ["water", "rivers_geo"] as const,
    queryFn: async (): Promise<RiverGeometry | null> => {
      const r = await fetch(dataUrl("/water/rivers.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return (await r.json()) as RiverGeometry;
    },
    staleTime: Infinity,
  });
