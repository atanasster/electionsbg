// React Query hooks for the Култура (culture) pillar. The offline pipeline
// (scripts/culture/ingest.ts) writes two committed files to data/culture/; the
// SPA fetches them whole and filters client-side. Same pattern as the budget /
// procurement hooks: dataUrl() seam, staleTime Infinity, 404 → null.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type {
  CultureFilmsFile,
  CultureFundingStreamsFile,
  CultureGrantsFile,
  CultureMunicipalFile,
  CultureOblastFile,
  CultureOverviewFile,
} from "./types";

const fetchJson = async <T,>(path: string): Promise<T | null> => {
  const r = await fetch(dataUrl(path));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as T;
};

/** The precomputed dashboard blob — totals, by-year, by-discipline, top
 *  producers. Every /culture tile except the raw film list reads from here. */
export const useCultureOverview = () =>
  useQuery({
    queryKey: ["culture", "overview"] as const,
    queryFn: () => fetchJson<CultureOverviewFile>("/culture/overview.json"),
    staleTime: Infinity,
  });

/** The full per-film corpus (~300 KB) — only the film-awards Top-N tile and any
 *  future browser need it, so it is a separate fetch from the overview. */
export const useCultureFilms = () =>
  useQuery({
    queryKey: ["culture", "films"] as const,
    queryFn: () => fetchJson<CultureFilmsFile>("/culture/films.json"),
    staleTime: Infinity,
  });

/** Annual culture-money streams by scale — the proportion context. */
export const useCultureFundingStreams = () =>
  useQuery({
    queryKey: ["culture", "funding-streams"] as const,
    queryFn: () =>
      fetchJson<CultureFundingStreamsFile>("/culture/funding_streams.json"),
    staleTime: Infinity,
  });

/** НФК grant results — applied vs funded (success rate) per program & discipline. */
export const useCultureGrants = () =>
  useQuery({
    queryKey: ["culture", "grants"] as const,
    queryFn: () => fetchJson<CultureGrantsFile>("/culture/grants.json"),
    staleTime: Infinity,
  });

/** Столична програма „Култура" + читалища national context — the municipal tile. */
export const useCultureMunicipal = () =>
  useQuery({
    queryKey: ["culture", "municipal"] as const,
    queryFn: () => fetchJson<CultureMunicipalFile>("/culture/municipal.json"),
    staleTime: Infinity,
  });

/** State cultural institutes located by oblast — the regional map. */
export const useCultureOblast = () =>
  useQuery({
    queryKey: ["culture", "oblast"] as const,
    queryFn: () => fetchJson<CultureOblastFile>("/culture/oblast.json"),
    staleTime: Infinity,
  });
