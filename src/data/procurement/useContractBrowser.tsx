// Data hooks for the faceted /procurement/contracts browser. The corpus is
// sharded by year (built by scripts/procurement/contract_index.ts); a year
// shard is loaded on demand and filtered client-side.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Positional row tuple — see contract_index.ts ROW_SCHEMA.
export type ContractRow = [
  string, // 0 date
  string, // 1 awarderEik
  string, // 2 awarderName
  string, // 3 contractorEik
  string, // 4 contractorName
  number, // 5 amountEur
  string, // 6 cpvDivision
  string, // 7 procedureBucket
  0 | 1 | null, // 8 euFunded
  string, // 9 title
];

export type ContractIndexMeta = {
  generatedAt: string;
  schema: string[];
  years: { year: string; count: number }[];
};

export const useContractIndexMeta = () =>
  useQuery({
    queryKey: ["procurement", "contract-index", "meta"] as const,
    queryFn: async (): Promise<ContractIndexMeta | null> => {
      const r = await fetch(
        dataUrl("/procurement/derived/contract_index/index.json"),
      );
      if (!r.ok) return null;
      return (await r.json()) as ContractIndexMeta;
    },
    staleTime: Infinity,
  });

export const useContractYear = (year?: string) =>
  useQuery({
    queryKey: ["procurement", "contract-index", year] as const,
    queryFn: async (): Promise<ContractRow[]> => {
      const r = await fetch(
        dataUrl(`/procurement/derived/contract_index/${year}.json`),
      );
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      return (await r.json()) as ContractRow[];
    },
    enabled: !!year,
    staleTime: Infinity,
  });
