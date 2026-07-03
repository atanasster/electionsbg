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

const fetchOrNull = async <T,>(url: string): Promise<T | null> => {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${url}`);
  return (await r.json()) as T;
};

/** Place key — numeric EKATTE (`"56784"`, settlement view) OR an obshtina
 * code (`"PDV22"`, municipality view). Routes to the matching shard family. */
export type CompaniesHqPlace =
  | { kind: "ekatte"; ekatte: string | undefined }
  | { kind: "muni"; obshtina: string | undefined };

const shardBase = (p: CompaniesHqPlace): { dir: string; id: string } => {
  if (p.kind === "ekatte") {
    return { dir: "companies-by-ekatte", id: p.ekatte ?? "" };
  }
  return { dir: "companies-by-obshtina", id: p.obshtina ?? "" };
};

export const useCompaniesHqSummary = (place: CompaniesHqPlace) => {
  const { dir, id } = shardBase(place);
  return useQuery({
    queryKey: ["companies-hq", "summary", dir, id] as const,
    queryFn: () =>
      fetchOrNull<CompaniesHqSummary>(
        dataUrl(`/parliament/${dir}/${id}-summary.json`),
      ),
    enabled: !!id,
    staleTime: Infinity,
  });
};

const pad3 = (n: number): string => String(n).padStart(3, "0");

export const useCompaniesHqPage = (place: CompaniesHqPlace, page: number) => {
  const { dir, id } = shardBase(place);
  return useQuery({
    queryKey: ["companies-hq", "page", dir, id, page] as const,
    queryFn: () =>
      fetchOrNull<CompaniesHqPage>(
        dataUrl(`/parliament/${dir}/${id}-page-${pad3(page)}.json`),
      ),
    enabled: !!id && page >= 1,
    staleTime: Infinity,
  });
};
