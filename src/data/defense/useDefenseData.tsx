// React Query hooks for the /defense national-defense screen. Small committed
// JSON files under data/defense/ (served via the dataUrl seam), written by the
// update-defense skill off the NATO PDF, the МО report and the Ministry of
// Economy arms-export report. Same pattern as the judiciary hooks: dataUrl(),
// staleTime Infinity, fetched whole and filtered client-side.
//
// UNLIKE the contract-corpus tiles, these are annual reference series; the %GDP
// path is a historical time-spine (never scoped), and single-year views on the
// screen re-aggregate the KPIs to a chosen year (culture/education pattern). See
// docs/plans/defense-pack-v1.md §Part-12.
//
// The file-shape interfaces live in ./types (dependency-free) so the AI-site
// tools can share them without crossing the ai/ ↔ @/data boundary; re-exported
// here for the existing tile consumers.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type {
  GdpShareFile,
  CategorySplitFile,
  ExportsFile,
  ProgramsFile,
  ReadinessFile,
  AviationSustainmentFile,
  PeersFile,
} from "./types";

export type * from "./types";

const fetchJson = async <T,>(path: string): Promise<T> => {
  const res = await fetch(dataUrl(path));
  if (!res.ok) throw new Error(`fetch ${path} -> ${res.status}`);
  return res.json();
};

// --- %GDP path ---------------------------------------------------------------

export const useDefenseGdpShare = () =>
  useQuery({
    queryKey: ["defense", "gdp_share"] as const,
    queryFn: () => fetchJson<GdpShareFile>("/defense/gdp_share.json"),
    staleTime: Infinity,
  });

// --- equipment / personnel / other split ------------------------------------

export const useDefenseCategorySplit = () =>
  useQuery({
    queryKey: ["defense", "category_split"] as const,
    queryFn: () => fetchJson<CategorySplitFile>("/defense/category_split.json"),
    staleTime: Infinity,
  });

// --- arms exports ------------------------------------------------------------

export const useDefenseExports = () =>
  useQuery({
    queryKey: ["defense", "exports"] as const,
    queryFn: () => fetchJson<ExportsFile>("/defense/exports.json"),
    staleTime: Infinity,
  });

// --- mega-programs -----------------------------------------------------------

export const useDefensePrograms = () =>
  useQuery({
    queryKey: ["defense", "programs"] as const,
    queryFn: () => fetchJson<ProgramsFile>("/defense/programs.json"),
    staleTime: Infinity,
  });

// --- readiness & budget split ------------------------------------------------

export const useDefenseReadiness = () =>
  useQuery({
    queryKey: ["defense", "readiness"] as const,
    queryFn: () => fetchJson<ReadinessFile>("/defense/readiness.json"),
    staleTime: Infinity,
  });

// --- aviation sustainment (the signature cross-buyer aggregate) --------------

export const useDefenseAviationSustainment = () =>
  useQuery({
    queryKey: ["defense", "aviation_sustainment"] as const,
    queryFn: () =>
      fetchJson<AviationSustainmentFile>("/defense/aviation_sustainment.json"),
    staleTime: Infinity,
  });

// --- peer comparison (%GDP vs neighbours + NATO Europe) ----------------------

export const useDefensePeers = () =>
  useQuery({
    queryKey: ["defense", "peers"] as const,
    queryFn: () => fetchJson<PeersFile>("/defense/peers.json"),
    staleTime: Infinity,
  });
