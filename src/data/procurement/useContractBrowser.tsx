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

// Dictionary-encoded year shard: names live in eik→name maps, rows carry only
// the eik (see scripts/procurement/contract_index.ts). The compact row is
//   [date, awarderEik, contractorEik, amount, cpvDivision, proc, eu, title].
type CompactRow = [
  string,
  string,
  string,
  number,
  string,
  string,
  0 | 1 | null,
  string,
];
type YearShard = {
  awarders: Record<string, string>;
  contractors: Record<string, string>;
  rows: CompactRow[];
};

export const useContractYear = (year?: string) =>
  useQuery({
    queryKey: ["procurement", "contract-index", year] as const,
    queryFn: async (): Promise<ContractRow[]> => {
      const r = await fetch(
        dataUrl(`/procurement/derived/contract_index/${year}.json`),
      );
      if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
      const data = (await r.json()) as YearShard | ContractRow[];
      // Back-compat: a bucket that hasn't re-synced may still serve the old
      // flat ContractRow[] (names inline). Use it as-is.
      if (Array.isArray(data)) return data;
      // Rehydrate to the public ContractRow shape, resolving names by reference
      // so every row shares one string per awarder/contractor (parse + memory
      // win vs repeating the name on each of ~40k rows).
      const { awarders, contractors, rows } = data;
      return rows.map((c) => [
        c[0],
        c[1],
        awarders[c[1]] ?? c[1],
        c[2],
        contractors[c[2]] ?? c[2],
        c[3],
        c[4],
        c[5],
        c[6],
        c[7],
      ]);
    },
    enabled: !!year,
    staleTime: Infinity,
  });
