// React Query hooks for the budget pillar. The offline pipeline writes three
// small committed files to data/budget/; the SPA fetches them whole (each is
// well under 100 KB) and filters client-side. Same pattern as the procurement
// hooks: dataUrl() seam, staleTime Infinity, 404 → null.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type {
  BudgetIndex,
  BudgetDocumentsFile,
  KfpFile,
  MinistryProcurementFile,
  MinistryRollup,
} from "./types";

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

// Phase 4 — the per-ministry procurement cross-link (budget admin unit → its
// public-procurement awarder + footprint).
export const useMinistryProcurement = () =>
  useQuery({
    queryKey: ["budget", "ministry-procurement"] as const,
    queryFn: () =>
      fetchJson<MinistryProcurementFile>(
        "/budget/derived/ministry_procurement.json",
      ),
    staleTime: Infinity,
  });

// Aggregated admin-grain spending — input for the admin view of the budget
// flow графика. Per-fiscal-year ministry-level totals from the State Budget
// Law, plus executed where ingested. ~30 KB at current data volumes.
export interface AdminFlowMinistry {
  nodeId: string;
  nameBg: string;
  nameEn: string;
  plannedEur: number;
  executedEur: number | null;
}
export interface AdminFlowYear {
  fiscalYear: number;
  plannedTotalEur: number;
  executedTotalEur: number | null;
  ministries: AdminFlowMinistry[];
}
export interface AdminFlowFile {
  generatedAt: string;
  fiscalYears: Record<string, AdminFlowYear>;
}

export const useBudgetAdminFlow = () =>
  useQuery({
    queryKey: ["budget", "admin-flow"] as const,
    queryFn: () => fetchJson<AdminFlowFile>("/budget/derived/admin_flow.json"),
    staleTime: Infinity,
  });

// One spending unit's self-contained rollup — the single small file the
// ministry detail screen fetches (years of figures + programs + procurement),
// instead of every year's whole-corpus reconciliation. 404 → null.
export const useBudgetMinistryRollup = (nodeId: string | undefined) =>
  useQuery({
    queryKey: ["budget", "ministry", nodeId] as const,
    queryFn: () =>
      fetchJson<MinistryRollup>(`/budget/ministries/${nodeId}.json`),
    enabled: !!nodeId,
    staleTime: Infinity,
  });
