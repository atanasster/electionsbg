// Data layer for /education + /school/:id. Fetches the precomputed 'directory'
// payload from Postgres (/api/db/education-payload) — the whole education dataset
// with the SES-context and 7th→12th value-added verdicts ALREADY COMPUTED in
// scripts/db/load_schools_pg.ts — and provides thin client-side helpers (byId,
// percentile, ranking) over it. The regressions live in the loader now, so this
// hook no longer ships the 1.25 MB raw index or recomputes anything; it fetches
// one ~150 KB blob. See docs/plans/education-mon-v1.md §5.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

/** A school's cohort must reach this to be RANKED / carry a firm score. */
export const MIN_RANK_COHORT = 10;

/** над = beats expectation · expected = typical · under = below expectation. */
export type ContextVerdict = "above" | "expected" | "under";

/** One school as served in the directory payload — display fields + the verdicts
 *  baked in by the loader. */
export interface DirectorySchool {
  id: string;
  name: string;
  obshtina: string;
  obshtinaName: string;
  oblast: string;
  address?: string;
  loc?: string;
  /** ЕИК (procurement awarder), for the school's own procurement link. */
  eik?: string;
  latestYear: number | null;
  latestScore: number | null;
  latestN: number | null;
  /** Ascending ДЗИ БЕЛ series. `n` is that year's cohort — absent on payloads
   *  built before it was added, so treat it as optional. */
  series: { year: number; score: number; n?: number }[];
  /** Newest ДЗИ Maths result, if any, with that year's cohort (`n` absent on
   *  payloads built before it was added). The second matura is elective, so
   *  this is often older than the school's latest БЕЛ year and often a handful
   *  of pupils — /school/:id says both rather than printing a bare average. */
  mathLatest: { year: number; score: number; n?: number } | null;
  /** Socioeconomic context of the school's obshtina (mean 0). */
  ses: number | null;
  predicted: number | null;
  residual: number | null;
  verdict: ContextVerdict | null;
  /** 7th-grade НВО points (prior attainment) of this ДЗИ cohort. */
  nvoPrior: number | null;
  vaPredicted: number | null;
  vaResidual: number | null;
  vaVerdict: ContextVerdict | null;
}

interface Regression {
  slope: number;
  intercept: number;
  residualSd: number;
  n: number;
}

interface DirectoryPayload {
  latestYear: number | null;
  schools: DirectorySchool[];
  nationalByYear: { year: number; avg: number | null; examinees: number }[];
  byOblast: {
    oblast: string;
    avg: number;
    examinees: number;
    schools: number;
  }[];
  /** Per-oblast matura series. Optional: the deployed payload predates this
   *  field, so the UI must degrade to the latest-year-only byOblast until the
   *  loader is re-run and shipped. */
  byOblastYear?: {
    oblast: string;
    years: {
      year: number;
      avg: number;
      examinees: number;
      schools: number;
    }[];
  }[];
  regression: Regression | null;
  nvoRegression: Regression | null;
  context: { weights: Record<string, number> };
}

const fetchDirectory = async (): Promise<DirectoryPayload | null> => {
  const r = await fetch("/api/db/education-payload?kind=directory");
  if (!r.ok) throw new Error("education directory fetch failed");
  return r.json(); // null if the migration isn't applied yet
};

export const useSchoolDirectory = () => {
  const { data } = useQuery({
    queryKey: ["education-directory"],
    queryFn: fetchDirectory,
    staleTime: Infinity,
  });

  return useMemo(() => {
    if (!data) return null;
    const schools = data.schools;
    const byId = new Map(schools.map((s) => [s.id, s]));
    const rankable = schools
      .filter(
        (s) => s.latestScore != null && (s.latestN ?? 0) >= MIN_RANK_COHORT,
      )
      .sort((a, b) => (b.latestScore ?? 0) - (a.latestScore ?? 0));
    const percentileOf = (score: number): number => {
      if (!rankable.length) return 0;
      const below = rankable.filter((s) => (s.latestScore ?? 0) < score).length;
      return Math.round((100 * below) / rankable.length);
    };
    const byResidual = schools
      .filter((s) => s.verdict != null && s.residual != null)
      .sort((a, b) => (b.residual ?? 0) - (a.residual ?? 0));
    return {
      ...data,
      schools,
      rankable,
      byId: (id: string) => byId.get(id) ?? null,
      percentileOf,
      byResidual,
    };
  }, [data]);
};

export type SchoolDirectory = NonNullable<
  ReturnType<typeof useSchoolDirectory>
>;

/** One under-performing school in the slim 'risk' payload — just the fields the
 *  МОН pack's SchoolRiskTile renders (the negative tail of the SES regression). */
export interface SchoolRiskRow {
  id: string;
  name: string;
  obshtinaName: string;
  latestScore: number | null;
  predicted: number | null;
  residual: number | null;
  vaVerdict: ContextVerdict | null;
}

interface SchoolRiskPayload {
  latestYear: number | null;
  schools: SchoolRiskRow[];
}

/** The top under-performing schools for the МОН sector pack. Fetches the slim
 *  `education-payload?kind=risk` blob (~3 KB) instead of the ~600 KB directory —
 *  the tile only shows the negative tail, so it must not pull the whole corpus.
 *  Returns null until the migration/loader has written the 'risk' row. */
export const useSchoolRisk = () =>
  useQuery({
    queryKey: ["education-risk"],
    queryFn: async (): Promise<SchoolRiskPayload | null> => {
      const r = await fetch("/api/db/education-payload?kind=risk");
      if (!r.ok) throw new Error("education risk fetch failed");
      return r.json(); // null if the loader hasn't written the risk blob yet
    },
    staleTime: Infinity,
  });

/** One school identified by its ЕИК — served from the RELATIONAL schools table
 *  (idx_schools_eik), for the "this EIK is a school" back-link on /company/:eik.
 *  null when the EIK isn't a matched school. */
export interface SchoolByEik {
  id: string;
  name: string;
  obshtina: string;
  oblast: string | null;
  latestYear: number | null;
  latestBel: number | null;
  latestN: number | null;
}

export const useSchoolByEik = (eik?: string | null) =>
  useQuery({
    queryKey: ["school-by-eik", eik ?? ""],
    queryFn: async (): Promise<SchoolByEik | null> => {
      const r = await fetch(
        `/api/db/school-by-eik?eik=${encodeURIComponent(eik!)}`,
      );
      if (!r.ok) throw new Error("school-by-eik fetch failed");
      return r.json(); // null when the EIK isn't a school
    },
    enabled: !!eik,
    staleTime: Infinity,
  });
