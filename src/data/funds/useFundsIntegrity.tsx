// SPA hooks for the Phase-7 integrity derivative.
//   - useFundsIntegrityIndex()      → slim leaderboard for /funds/integrity
//   - useFundsIntegrityForProgram() → per-programme drill-down (top 10
//                                      beneficiaries + debarred matches)

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type HhiBand = "low" | "moderate" | "high";

export interface IntegrityBeneficiary {
  eik: string | null;
  name: string;
  totalEur: number;
  share: number;
  contractCount: number;
}

export interface IntegrityProgramFile {
  programCode: string;
  programName: string;
  period: string;
  fundType: string;
  totals: {
    contractCount: number;
    beneficiaryCount: number;
    totalEur: number;
    paidEur: number;
  };
  hhi: number;
  hhiBand: HhiBand;
  top5Share: number;
  top1Share: number;
  topBeneficiaries: IntegrityBeneficiary[];
  debarredBeneficiaryCount: number;
  debarredBeneficiaryEur: number;
  debarredBeneficiaries: IntegrityBeneficiary[];
}

export interface IntegritySerialWinner {
  eik: string | null;
  name: string;
  programmeCount: number;
  totalEur: number;
  topProgrammes: Array<{
    programCode: string;
    programName: string;
    eur: number;
  }>;
}

export interface IntegrityIndexFile {
  generatedAt: string;
  totals: {
    programmeCount: number;
    highConcentrationCount: number;
    moderateConcentrationCount: number;
    debarredOverlapCount: number;
    debarredOverlapEur: number;
  };
  topByConcentration: Array<{
    programCode: string;
    programName: string;
    period: string;
    fundType: string;
    totalEur: number;
    paidEur: number;
    contractCount: number;
    beneficiaryCount: number;
    hhi: number;
    hhiBand: HhiBand;
    top1Share: number;
    top1Name: string;
    debarredFlag: boolean;
  }>;
  topSerialWinners: IntegritySerialWinner[];
  debarredFlagged: Array<{
    eik: string | null;
    name: string;
    totalEur: number;
    programmeCount: number;
  }>;
}

const fetchJson = async <T,>(p: string): Promise<T | null> => {
  const r = await fetch(dataUrl(p));
  if (r.status === 404) return null;
  if (!r.ok) return null;
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return null;
  return (await r.json()) as T;
};

export const useFundsIntegrityIndex = () =>
  useQuery({
    queryKey: ["funds", "integrity_index"] as const,
    queryFn: () =>
      fetchJson<IntegrityIndexFile>("/funds/derived/integrity.json"),
    staleTime: Infinity,
    retry: false,
  });

export const useFundsIntegrityForProgram = (programCode?: string | null) =>
  useQuery({
    queryKey: ["funds", "integrity_program", programCode ?? ""] as const,
    queryFn: () =>
      fetchJson<IntegrityProgramFile>(
        `/funds/derived/integrity-by-program/${programCode}.json`,
      ),
    staleTime: Infinity,
    retry: false,
    enabled: !!programCode,
  });
