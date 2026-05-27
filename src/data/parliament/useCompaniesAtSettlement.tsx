// MP-linked companies HQ'd at a settlement. Backs the `CompaniesHqTile`
// (summary shard) and the paginated detail screen (`{ekatte}-page-NNN.json`).
//
// Sources written by scripts/parliament/build_companies_by_settlement.ts.
// 404 means the place has no MP-linked HQs — the tile renders null in that
// case rather than an empty card. Sofia capital (ekatte 68134) is the only
// place with multi-page pagination today.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type CompaniesHqRow = {
  slug: string;
  displayName: string;
  registeredOffice: string | null;
  mps: Array<{
    mpId: number;
    mpName: string;
    role: string;
    isCurrent: boolean;
  }>;
};

export type CompaniesHqSummary = {
  ekatte: string;
  count: number;
  mpCount: number;
  totalPages: number;
  topCompanies: CompaniesHqRow[];
};

export type CompaniesHqPage = {
  ekatte: string;
  page: number;
  totalPages: number;
  count: number;
  companies: CompaniesHqRow[];
};

export type CompaniesHqIndexEntry = {
  count: number;
  mpCount: number;
  topMpIds: number[];
};

export type CompaniesHqIndexFile = {
  generatedAt: string;
  total: number;
  settlements: Record<string, CompaniesHqIndexEntry>;
};

const fetchOrNull = async <T,>(url: string): Promise<T | null> => {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${url}`);
  return (await r.json()) as T;
};

export const useCompaniesHqSummary = (ekatte: string | undefined) =>
  useQuery({
    queryKey: ["companies-hq", "summary", ekatte ?? ""] as const,
    queryFn: () =>
      fetchOrNull<CompaniesHqSummary>(
        dataUrl(`/parliament/companies-by-ekatte/${ekatte}-summary.json`),
      ),
    enabled: !!ekatte,
    staleTime: Infinity,
  });

const pad3 = (n: number): string => String(n).padStart(3, "0");

export const useCompaniesHqPage = (ekatte: string | undefined, page: number) =>
  useQuery({
    queryKey: ["companies-hq", "page", ekatte ?? "", page] as const,
    queryFn: () =>
      fetchOrNull<CompaniesHqPage>(
        dataUrl(
          `/parliament/companies-by-ekatte/${ekatte}-page-${pad3(page)}.json`,
        ),
      ),
    enabled: !!ekatte && page >= 1,
    staleTime: Infinity,
  });

export const useCompaniesHqIndex = () =>
  useQuery({
    queryKey: ["companies-hq", "index"] as const,
    queryFn: () =>
      fetchOrNull<CompaniesHqIndexFile>(
        dataUrl(`/parliament/companies-by-ekatte/index.json`),
      ),
    staleTime: Infinity,
  });
