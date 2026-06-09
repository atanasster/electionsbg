// Data hooks for the район-breakdown layer on the three общини с районно деление
// the core pipeline does not split (today only Plovdiv-city PDV22 and Varna-city
// VAR06 are served; Sofia is already split МИР-side). Both artifacts are
// generated additively from per-section data by
// scripts/helpers/gen_city_rayon_data.ts:
//   - results  /<election>/rayon/<muni>.json   (per election)
//   - geometry /maps/city_rayons/<muni>.json   (election-independent)
// The tile self-hides whenever either is absent, so this stays inert for every
// other município.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";

export type CityRayonVote = {
  partyNum: number;
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
};

export type CityRayonResult = {
  key: string;
  obshtina: string;
  oblast: string;
  name: string;
  name_en: string;
  results: {
    votes: CityRayonVote[];
    protocol: { totalActualVoters: number; numValidVotes: number };
  };
};

export type CityRayonData = {
  municipality: string;
  rayons: CityRayonResult[];
  // Mobile/ship sections (район code 00) carry no fixed location, so they get
  // no polygon — summed here so no voter is silently dropped from the city.
  mobile?: { voters: number; votes: CityRayonVote[] };
};

export type CityRayonFeature = {
  type: "Feature";
  properties: {
    nuts4: string;
    nuts3: string;
    rayon: string;
    name: string;
    name_en: string;
    loc: string; // "lon,lat" centroid for the map marker
  };
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
};
export type CityRayonGeo = {
  type: "FeatureCollection";
  features: CityRayonFeature[];
};

// Municípios that have a район-breakdown layer. Kept explicit (not data-driven)
// so the hooks short-circuit without a network round-trip for every other muni.
const CITY_RAYON_MUNIS = new Set(["PDV22", "VAR06"]);
export const hasCityRayons = (muni?: string | null): boolean =>
  !!muni && CITY_RAYON_MUNIS.has(muni);

export const useCityRayonResults = (muni?: string) => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["city_rayons", selected, muni],
    queryFn: async (): Promise<CityRayonData | null> => {
      const r = await fetch(dataUrl(`/${selected}/rayon/${muni}.json`));
      if (!r.ok) return null;
      return r.json();
    },
    enabled: hasCityRayons(muni),
    staleTime: Infinity,
  });
};

export const useCityRayonMap = (muni?: string) => {
  return useQuery({
    queryKey: ["city_rayons_map", muni],
    queryFn: async (): Promise<CityRayonGeo | null> => {
      const r = await fetch(dataUrl(`/maps/city_rayons/${muni}.json`));
      if (!r.ok) return null;
      return r.json();
    },
    enabled: hasCityRayons(muni),
    staleTime: Infinity,
  });
};
