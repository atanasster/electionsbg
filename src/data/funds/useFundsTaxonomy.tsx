// SPA hooks for the Phase-6 derivatives:
//   - useFundsTaxonomy()    → period + fund-type lookup per programme code
//   - useFundsAbsorption()  → per-period / per-fund / per-programme rollups
//   - useFundsSankey()      → Fund → OP → top-20 beneficiary flow data
//
// Each file is absent on a fresh clone until funds:ingest-projects has run —
// the queries return `null` rather than throwing.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type FundsPeriod = "2007-13" | "2014-20" | "2021-27" | "RRP";
export type FundType =
  | "ERDF"
  | "ESF"
  | "CF"
  | "EAFRD"
  | "EMFF"
  | "JTF"
  | "RRP"
  | "Other";

export interface AbsorptionRow {
  contractedEur: number;
  paidEur: number;
  absorptionPct: number;
  contractCount: number;
}

export interface AbsorptionBucket {
  bucket: string;
  period: FundsPeriod;
  fundType: FundType;
  contractedEur: number;
  paidEur: number;
  absorptionPct: number;
  contractCount: number;
}

export interface AbsorptionProgramme {
  programCode: string;
  programName: string;
  period: FundsPeriod;
  fundType: FundType;
  contractedEur: number;
  paidEur: number;
  absorptionPct: number;
  contractCount: number;
}

export interface AbsorptionFile {
  generatedAt: string;
  byPeriod: Record<FundsPeriod, AbsorptionRow>;
  byFundType: Record<FundType, AbsorptionRow>;
  byBucket: AbsorptionBucket[];
  byProgramme: AbsorptionProgramme[];
}

export interface TaxonomyEntry {
  programCode: string;
  programName: string;
  period: FundsPeriod;
  fundType: FundType;
  bucket: string;
  fundLabel: string;
  contractCount: number;
  totalEur: number;
  paidEur: number;
}

export interface TaxonomyFile {
  generatedAt: string;
  programmes: TaxonomyEntry[];
}

export interface FundsSankeyNode {
  id: string;
  kind: "fund" | "programme" | "beneficiary";
  label: string;
  totalEur: number;
  bucket?: string;
  eik?: string | null;
}

export interface FundsSankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface FundsSankeyFile {
  generatedAt: string;
  totalContracted: number;
  topN: number;
  nodes: FundsSankeyNode[];
  links: FundsSankeyLink[];
}

const fetchJson = async <T,>(path: string): Promise<T | null> => {
  const r = await fetch(dataUrl(path));
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as T;
};

/** Per-programme taxonomy (period, fund family, MA-friendly bucket label). */
export const useFundsTaxonomy = () =>
  useQuery({
    queryKey: ["funds", "taxonomy"] as const,
    queryFn: () => fetchJson<TaxonomyFile>("/funds/taxonomy.json"),
    staleTime: Infinity,
    retry: false,
  });

/** Absorption rollups — per period, per fund type, per "bucket"
 * (period + fund), and per programme. ~5-10 KB total. */
export const useFundsAbsorption = () =>
  useQuery({
    queryKey: ["funds", "absorption"] as const,
    queryFn: () => fetchJson<AbsorptionFile>("/funds/derived/absorption.json"),
    staleTime: Infinity,
    retry: false,
  });

/** Precomputed Sankey flow: fund-family → programme → top-N beneficiary.
 * ~30-50 KB. */
export const useFundsSankey = () =>
  useQuery({
    queryKey: ["funds", "sankey"] as const,
    queryFn: () => fetchJson<FundsSankeyFile>("/funds/derived/sankey.json"),
    staleTime: Infinity,
    retry: false,
  });
