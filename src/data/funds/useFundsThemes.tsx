// SPA hooks for the Phase-8 focus-theme derivatives.
//   - useFundsThemesIndex() — slim list of themes (for the /funds tile +
//                              /funds/focus router)
//   - useFundsTheme(slug)   — per-theme shard

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface ThemeInvestigativeCard {
  outlet: string;
  title: string;
  url: string;
}

export interface ThemeBeneficiary {
  eik: string | null;
  name: string;
  contractCount: number;
  totalEur: number;
  paidEur: number;
}

export interface ThemeProgramme {
  programCode: string;
  programName: string;
  contractCount: number;
  totalEur: number;
  paidEur: number;
}

export interface ThemeMuni {
  muni: string;
  contractCount: number;
  totalEur: number;
}

export interface ThemeContract {
  contractNumber: string;
  title: string;
  beneficiaryEik: string | null;
  beneficiaryName: string;
  programCode: string;
  programName: string;
  totalEur: number;
  paidEur: number;
  status: string;
  locationRaw: string;
}

export interface ThemeShard {
  slug: string;
  labelBg: string;
  labelEn: string;
  summaryBg: string;
  summaryEn: string;
  icon: string;
  totals: {
    contractCount: number;
    beneficiaryCount: number;
    totalEur: number;
    paidEur: number;
  };
  topBeneficiaries: ThemeBeneficiary[];
  topContracts: ThemeContract[];
  topMunis: ThemeMuni[];
  programmes: ThemeProgramme[];
  investigativeCards: ThemeInvestigativeCard[];
}

export interface ThemesIndexFile {
  generatedAt: string;
  themes: Array<{
    slug: string;
    labelBg: string;
    labelEn: string;
    summaryBg: string;
    summaryEn: string;
    icon: string;
    contractCount: number;
    totalEur: number;
    paidEur: number;
    beneficiaryCount: number;
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

export const useFundsThemesIndex = () =>
  useQuery({
    queryKey: ["funds", "themes_index"] as const,
    queryFn: () =>
      fetchJson<ThemesIndexFile>("/funds/derived/themes/index.json"),
    staleTime: Infinity,
    retry: false,
  });

export const useFundsTheme = (slug?: string) =>
  useQuery({
    queryKey: ["funds", "theme_shard", slug ?? ""] as const,
    queryFn: () => fetchJson<ThemeShard>(`/funds/derived/themes/${slug}.json`),
    staleTime: Infinity,
    retry: false,
    enabled: !!slug,
  });
