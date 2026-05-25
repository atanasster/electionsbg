// React Query hooks for the budget pillar. The offline pipeline writes three
// small committed files to data/budget/; the SPA fetches them whole (each is
// well under 100 KB) and filters client-side. Same pattern as the procurement
// hooks: dataUrl() seam, staleTime Infinity, 404 → null.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import type {
  BudgetIndex,
  BudgetDocumentsFile,
  CustomsBreakdownFile,
  KfpFile,
  MinistryProcurementFile,
  MinistryRollup,
  PersonnelFile,
  PitBreakdownFile,
  VatBreakdownFile,
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

// Personnel — per-programme headcount × Персонал spend (from each ministry's
// program-budget execution report) plus the annual Доклад за състоянието на
// администрацията aggregates. Single committed file (~80 KB across 9 years).
export const usePersonnel = () =>
  useQuery({
    queryKey: ["budget", "personnel"] as const,
    queryFn: () => fetchJson<PersonnelFile>("/budget/personnel.json"),
    staleTime: Infinity,
  });

// Revenue-side breakdowns — itemise each Sankey LEFT-side wedge into its
// sub-flows. Coverage is per-fiscal-year-file; pickers fall back to the most
// recent available year when the selected one isn't ingested yet (mirrors
// `usePersonnel`'s pattern).

export const useCustomsBreakdown = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "customs", fiscalYear] as const,
    queryFn: () =>
      fetchJson<CustomsBreakdownFile>(
        `/budget/revenue_breakdown/customs/${fiscalYear}.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

export const useVatBreakdown = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "vat", fiscalYear] as const,
    queryFn: () =>
      fetchJson<VatBreakdownFile>(
        `/budget/revenue_breakdown/vat/${fiscalYear}.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });

export const usePitBreakdown = (fiscalYear: number | undefined) =>
  useQuery({
    queryKey: ["budget", "pit", fiscalYear] as const,
    queryFn: () =>
      fetchJson<PitBreakdownFile>(
        `/budget/revenue_breakdown/pit/${fiscalYear}.json`,
      ),
    enabled: !!fiscalYear,
    staleTime: Infinity,
  });
