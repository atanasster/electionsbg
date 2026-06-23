// Data hooks for the faceted /procurement/contracts browser. The corpus is
// sharded by year (built by scripts/procurement/contract_index.ts); a year
// shard is loaded on demand and filtered client-side. The "All years" mode
// (useAllContractYears) merges every shard for cross-year text search — opt-in,
// since the merged corpus is ~85 MB raw.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Positional row tuple — see contract_index.ts ROW_SCHEMA. Fields 10+ are
// appended, so they are `undefined` on shards served before each schema bump
// (back-compat: every reader of [0..9] is unchanged; consumers must treat the
// later slots as optional).
export type ContractRow = [
  string, // 0 date
  string, // 1 awarderEik
  string, // 2 awarderName
  string, // 3 contractorEik
  string, // 4 contractorName
  number, // 5 amountEur
  string, // 6 cpvDivision (2-digit)
  string, // 7 procedureBucket
  0 | 1 | null, // 8 euFunded
  string, // 9 title
  string?, // 10 key — deep-link to /procurement/contract/:key
  (number | null)?, // 11 bidCount (numberOfTenderers) — single-bidder flag
  string?, // 12 cpv (full 8-digit) — sector-cell tooltip
  string?, // 13 euProgram — EU-badge tooltip
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
//   [date, awarderEik, contractorEik, amount, cpvDivision, proc, eu, title,
//    key, bidCount, cpvFull, euProgram].
type CompactRow = [
  string,
  string,
  string,
  number,
  string,
  string,
  0 | 1 | null,
  string,
  string?,
  (number | null)?,
  string?,
  string?,
];
type YearShard = {
  awarders: Record<string, string>;
  contractors: Record<string, string>;
  rows: CompactRow[];
};

// Rehydrate a dictionary-encoded shard to the public ContractRow shape,
// resolving names by reference so every row shares one string per
// awarder/contractor (parse + memory win vs repeating the name on each row).
const rehydrate = (data: YearShard | ContractRow[]): ContractRow[] => {
  // Back-compat: a bucket that hasn't re-synced may still serve the old flat
  // ContractRow[] (names inline). Use it as-is.
  if (Array.isArray(data)) return data;
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
    c[8],
    c[9],
    c[10],
    c[11],
  ]);
};

const fetchYear = async (year: string): Promise<ContractRow[]> => {
  const r = await fetch(
    dataUrl(`/procurement/derived/contract_index/${year}.json`),
  );
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
  return rehydrate((await r.json()) as YearShard | ContractRow[]);
};

export const useContractYear = (year?: string) =>
  useQuery({
    queryKey: ["procurement", "contract-index", year] as const,
    queryFn: () => fetchYear(year as string),
    enabled: !!year,
    staleTime: Infinity,
  });

// Cross-year search: merge every year shard into one list. Opt-in (the year
// facet's "All years" option) because the merged corpus is large (~85 MB raw /
// ~300k rows). Each shard is fetched in parallel; React Query caches the merged
// result so re-entry is instant.
export const useAllContractYears = (
  years: string[] | undefined,
  enabled: boolean,
) =>
  useQuery({
    queryKey: [
      "procurement",
      "contract-index",
      "all",
      years?.join(","),
    ] as const,
    queryFn: async (): Promise<ContractRow[]> => {
      const shards = await Promise.all((years ?? []).map((y) => fetchYear(y)));
      return shards.flat();
    },
    enabled: enabled && !!years && years.length > 0,
    staleTime: Infinity,
  });
