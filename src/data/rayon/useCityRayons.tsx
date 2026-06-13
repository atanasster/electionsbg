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
import type { ElectionInfo, SectionInfo, StatsVote } from "@/data/dataTypes";

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
    protocol: {
      // Optional: only rayon JSON emitted after the numRegisteredVoters
      // generator change carries it (older cycles fall back to no turnout Δ).
      numRegisteredVoters?: number;
      totalActualVoters: number;
      numValidVotes: number;
    };
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

// МИР (the leading two digits of every 9-digit ЦИК section id) of each split
// município — the by-oblast section bundle is keyed by it. PDV22 = 16 МИР
// Пловдив-град, VAR06 = 03 МИР Варна; both are single-община МИРs.
const CITY_RAYON_MIR: Record<string, string> = { PDV22: "16", VAR06: "03" };

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

// The polling sections of ONE район (e.g. PDV22 код "04"), as the SectionInfo[]
// that SectionsMapTile / SectionsMap render as located markers — so a sub-city
// район shows just its own sections (like a Sofia район's "Карта на секциите"),
// not the parent city's whole choropleth. Filtered out of the município's МИР
// section bundle (the one useSectionsVotes already caches) by the section id's
// община digits (3–4) and район digits (5–6). Mobile/ship sections (район код
// "00") carry no location and are dropped by SectionsMap's coord filter anyway.
export const useCityRayonSections = (muni?: string, code?: string) => {
  const { selected } = useElectionContext();
  return useQuery({
    queryKey: ["city_rayon_sections", selected, muni, code],
    queryFn: async (): Promise<SectionInfo[]> => {
      const mir = muni ? CITY_RAYON_MIR[muni] : undefined;
      if (!mir || !code) return [];
      const muniDigits = muni!.replace(/^[A-Z]+/, "");
      const r = await fetch(
        dataUrl(`/${selected}/sections/by-oblast/${mir}.json`),
      );
      if (!r.ok) return [];
      const data = (await r.json()) as Record<string, SectionInfo>;
      return Object.values(data).filter((s) => {
        const id = String(s.section);
        return id.slice(2, 4) === muniDigits && id.slice(4, 6) === code;
      });
    },
    enabled: hasCityRayons(muni) && !!code,
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
      // allSettled, not all: one election's rayon JSON failing with a non-404
      // (a 500 or a network-level reject) must degrade to "fewer cycles", not
      // blank the whole history tile.
      const settled = await Promise.allSettled(
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
      return settled
        .filter(
          (r): r is PromiseFulfilledResult<ElectionInfo> =>
            r.status === "fulfilled" && r.value !== null,
        )
        .map((r) => r.value);
    },
    enabled: hasCityRayons(muni) && !!code,
    staleTime: Infinity,
  });
};
