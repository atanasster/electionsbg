// React Query hooks for the budget pillar. The offline pipeline writes three
// small committed files to data/budget/; the SPA fetches them whole (each is
// well under 100 KB) and filters client-side. Same pattern as the procurement
// hooks: dataUrl() seam, staleTime Infinity, 404 → null.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type { BudgetIndex, BudgetDocumentsFile, KfpFile } from "./types";

const fetchJson = async <T,>(path: string): Promise<T | null> => {
  const r = await fetch(dataUrl(path));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  return (await r.json()) as T;
};

export const useBudgetIndex = () =>
  useQuery({
    queryKey: ["budget", "index"] as const,
    queryFn: () => fetchJson<BudgetIndex>("/budget/index.json"),
    staleTime: Infinity,
  });

export const useKfp = () =>
  useQuery({
    queryKey: ["budget", "kfp"] as const,
    queryFn: () => fetchJson<KfpFile>("/budget/kfp.json"),
    staleTime: Infinity,
  });

export const useBudgetDocuments = () =>
  useQuery({
    queryKey: ["budget", "documents"] as const,
    queryFn: () => fetchJson<BudgetDocumentsFile>("/budget/documents.json"),
    staleTime: Infinity,
  });
