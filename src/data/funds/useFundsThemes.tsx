// SPA hooks for the Phase-8 focus-theme derivatives.
//   - useFundsThemesIndex() — slim list of themes (for the /funds tile +
//                              /funds/focus router)
//   - useFundsTheme(slug)   — per-theme shard

import { useQuery } from "@tanstack/react-query";
import { fetchFundPayload } from "./fetchFundPayload";

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

export const useFundsThemesIndex = () =>
  useQuery({
    queryKey: ["funds", "themes_index"] as const,
    queryFn: () => fetchFundPayload<ThemesIndexFile>("themes-index"),
    staleTime: Infinity,
    retry: false,
  });

export const useFundsTheme = (slug?: string) =>
  useQuery({
    queryKey: ["funds", "theme_shard", slug ?? ""] as const,
    queryFn: () => fetchFundPayload<ThemeShard>("theme", slug),
    staleTime: Infinity,
    retry: false,
    enabled: !!slug,
  });
