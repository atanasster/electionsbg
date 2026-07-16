import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

// Citizen digital skills — Eurostat isoc_sk_dskl_i21 (DESI human-capital pillar).
// Built by scripts/administration/fetch_digital_skills.ts. The demand-side
// companion to egov.json: how able the population is to use digital services.
// Bulgaria ranks 26/27 in the EU on "at least basic digital skills" and last
// among young people (16-24). Includes the full-27 youth cross-section that
// powers the reusable EU choropleth.

export interface DigitalSkillsPoint {
  year: number;
  value: number;
}

export interface DigitalSkillsArea {
  code: string;
  labelBg: string;
  labelEn: string;
  bgValue: number | null;
  euValue: number | null;
}

export interface DigitalSkillsComposition {
  year: number;
  atLeastBasic?: number;
  below?: number;
  noSkills?: number;
  notAssessed?: number;
}

export interface EuRank {
  rank: number;
  total: number;
  isLast: boolean;
}

export interface DigitalSkillsPayload {
  indicator: {
    dataset: string;
    code: string;
    titleBg: string;
    titleEn: string;
    unit: string;
  };
  source: { name: string; url: string };
  fetchedAt: string;
  latestYear: number;
  peers: string[];
  rank: EuRank | null;
  atLeastBasic: Record<string, DigitalSkillsPoint[]>;
  composition: DigitalSkillsComposition[];
  areas: DigitalSkillsArea[];
  youth: {
    latestYear: number;
    unit: string;
    byGeo: Record<string, number>;
    rank: EuRank | null;
    bg: { total: number | null; male: number | null; female: number | null };
  };
}

export const useAdminDigitalSkills = () =>
  useQuery({
    queryKey: ["administration", "digital_skills"] as const,
    queryFn: async (): Promise<DigitalSkillsPayload | undefined> => {
      const res = await fetch(dataUrl("/administration/digital_skills.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as DigitalSkillsPayload;
    },
    staleTime: Infinity,
  });
