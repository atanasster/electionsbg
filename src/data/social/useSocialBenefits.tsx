// АСП benefit-disbursement statistics for the social view's Phase-3 tiles (heating
// aid + child-allowance coverage). Reads the small static data/social/benefits.json
// (national/annual, curated + verified from the АСП годишен отчет PDFs — no per-oblast
// data is published; see docs/plans/social-assistance-view-v1.md §2.1). Amounts are
// stored in BGN; EUR is computed here from `eurRate` so there is no hand-maintained
// EUR drift.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type BenefitId = "disability" | "child" | "gmi" | "heating";
export type BenefitUnit = "annual" | "season";

interface Bilingual {
  bg: string;
  en: string;
}

/** One period's disbursement for a benefit family (year for annual, season for heating). */
export interface BenefitPoint {
  year: number;
  season?: string;
  /** Recipients (annual families) or households (heating). */
  recipients?: number;
  households?: number;
  amountBgn: number;
  /** Computed from amountBgn / eurRate at load. */
  amountEur: number;
  perHouseholdMonthlyBgn?: number;
}

export interface BenefitFamily {
  id: BenefitId;
  label: Bilingual;
  law: string;
  recipientNoun: Bilingual;
  unit: BenefitUnit;
  meansTestBgn?: number;
  series: BenefitPoint[];
  note: Bilingual;
}

export interface SocialBenefitsPayload {
  fetchedAt: string;
  source: {
    publisher: string;
    description: string;
    reports: Record<string, string>;
    landing: string;
  };
  latestYear: number;
  eurRate: number;
  families: BenefitFamily[];
}

interface RawPoint extends Omit<BenefitPoint, "amountEur"> {
  amountEur?: number;
}
interface RawFamily extends Omit<BenefitFamily, "series"> {
  series: RawPoint[];
}
interface RawPayload extends Omit<SocialBenefitsPayload, "families"> {
  families: RawFamily[];
}

export const useSocialBenefits = () =>
  useQuery({
    queryKey: ["social", "benefits"],
    queryFn: async (): Promise<SocialBenefitsPayload | undefined> => {
      const res = await fetch(dataUrl("/social/benefits.json"));
      if (!res.ok) return undefined;
      const raw = (await res.json()) as RawPayload;
      const rate = raw.eurRate > 0 ? raw.eurRate : 1.95583;
      return {
        ...raw,
        families: raw.families.map((f) => ({
          ...f,
          series: f.series.map((p) => ({
            ...p,
            amountEur: Math.round(p.amountBgn / rate),
          })),
        })),
      };
    },
    staleTime: Infinity,
  });

/** Convenience: the family by id (undefined if absent). */
export const benefitFamily = (
  data: SocialBenefitsPayload | undefined,
  id: BenefitId,
): BenefitFamily | undefined => data?.families.find((f) => f.id === id);
