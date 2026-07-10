// React Query hook for the judiciary caseload series. One small committed file
// (~30 KB) written by scripts/judiciary/__write_caseload.ts off the ВСС annual
// "Обобщени статистически таблици" PDFs. Same pattern as the budget hooks:
// dataUrl() seam, staleTime Infinity, fetched whole and filtered client-side.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export interface JudiciaryTier {
  id: string;
  bg: string;
  en: string;
  /** Movement of cases (Приложение № 1, section I). */
  pendingStart: number;
  filed: number;
  toConsider: number;
  resolved: number;
  withinDeadline: number;
  withinDeadlinePct: number;
  onMerits: number;
  terminated: number;
  pendingEnd: number;
  appealed: number;
  /** Bench + workload (section II). */
  judges: number;
  /** Натовареност ПО ЩАТ — cases per allocated judge post, per month. */
  loadPerPostToConsider: number;
  loadPerPostResolved: number;
  personMonths: number;
  /** ДЕЙСТВИТЕЛНА натовареност — cases per month actually worked. */
  actualLoadToConsider: number;
  actualLoadResolved: number;
}

export interface JudiciaryYear {
  year: number;
  tiers: JudiciaryTier[];
  total: JudiciaryTier;
}

export interface JudiciaryCaseloadFile {
  generatedAt: string;
  source: { publisher: string; url: string; description: string };
  latestYear: number;
  years: JudiciaryYear[]; // descending by year
}

const fetchJson = async <T,>(path: string): Promise<T> => {
  const res = await fetch(dataUrl(path));
  if (!res.ok) throw new Error(`fetch ${path} -> ${res.status}`);
  return res.json();
};

export const useJudiciaryCaseload = () =>
  useQuery({
    queryKey: ["judiciary", "caseload"] as const,
    queryFn: () => fetchJson<JudiciaryCaseloadFile>("/judiciary/caseload.json"),
    staleTime: Infinity,
  });

/** Clearance rate — resolved ÷ filed. Above 100% the courts are eating into the
 *  backlog; below, the backlog grows. The single most legible court-health number. */
export const clearanceRate = (t: JudiciaryTier): number =>
  t.filed > 0 ? t.resolved / t.filed : 0;
