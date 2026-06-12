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
import allElections from "@/data/json/elections.json";
import type { ElectionInfo, StatsVote } from "@/data/dataTypes";

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

// Cross-election history for ONE район (e.g. PDV22 код "06"), shaped as the
// ElectionInfo[] that HistoricalTrendsTile/BubbleTimeline already consume for
// municipalities. The район layer (per-election rayon JSON) only carries
// partyNum + tallies, and ballot numbers are per-election — so we borrow each
// election's NATIONAL StatsVote (from elections.json, which bakes nickName /
// colour / canonical lineage) and rescale it to the район's totals. No new
// pipeline artifact: it's a client-side join over the files gen_city_rayon_data
// already emits for every election.
export const useCityRayonHistory = (muni?: string, code?: string) => {
  return useQuery({
    queryKey: ["city_rayon_history", muni, code],
    queryFn: async (): Promise<ElectionInfo[]> => {
      const elections = allElections as ElectionInfo[];
      const perElection = await Promise.all(
        elections.map(async (el): Promise<ElectionInfo | null> => {
          const r = await fetch(dataUrl(`/${el.name}/rayon/${muni}.json`));
          if (!r.ok) return null;
          const data: CityRayonData = await r.json();
          const rayon = data.rayons.find((x) => x.key === code);
          if (!rayon) return null;
          // partyNum → that election's national StatsVote (carries the names).
          const natById = new Map(
            (el.results?.votes ?? []).map((v) => [v.partyNum, v]),
          );
          const votes: StatsVote[] = rayon.results.votes
            .map((v) => {
              const nat = natById.get(v.partyNum);
              if (!nat) return null;
              return {
                ...nat,
                totalVotes: v.totalVotes,
                paperVotes: v.paperVotes,
                machineVotes: v.machineVotes,
              } as StatsVote;
            })
            .filter((v): v is StatsVote => v !== null);
          if (!votes.length) return null;
          return {
            name: el.name,
            results: { ...rayon.results, votes },
          };
        }),
      );
      return perElection.filter((e): e is ElectionInfo => e !== null);
    },
    enabled: hasCityRayons(muni) && !!code,
    staleTime: Infinity,
  });
};
