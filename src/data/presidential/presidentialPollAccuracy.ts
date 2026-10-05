// Pure projections over the presidential `accuracy.json` `agencies` rows — the round-one grades
// `parliamentaryRuleAgencies` (scripts/polls/presidential/analyze_accuracy.ts) writes. Shared by
// the cycle page's polls cards, the `/polls/presidential` hub and the per-agency presidential
// page, so the three cannot disagree about an average or about which cycles count.
//
// ⚠ A CYCLE WITH NO GRADED AGENCY CONTRIBUTES NOTHING — never a zero. 2006 and 2001 have no
// gradable poll, and a 0 MAE there would read as „the agencies were perfect".

import type {
  PresidentialAgencyError,
  PresidentialCycleAccuracy,
} from "@/data/polls/pollsTypes";

export type PresidentialTrendRow = {
  cycle: string;
  /** ISO round-one date. */
  date: string;
  avgMae: number;
  maxMae: number;
  agencyCount: number;
};

/** One row per graded cycle, oldest first. */
export const presidentialTrendRows = (
  cycles: readonly PresidentialCycleAccuracy[],
): PresidentialTrendRow[] =>
  cycles
    .filter((c) => c.agencies.length > 0)
    .map((c) => {
      const maes = c.agencies.map((a) => a.mae);
      return {
        cycle: c.cycle,
        date: c.round1Date,
        avgMae: maes.reduce((s, v) => s + v, 0) / maes.length,
        maxMae: Math.max(...maes),
        agencyCount: maes.length,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

export type PresidentialAgencyStanding = {
  agencyId: string;
  /** Mean of the agency's per-cycle MAE over the cycles it was graded in. */
  meanMae: number;
  cycles: number;
  /** Median days between fieldwork end and round one. */
  medianDaysBefore: number;
};

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Agencies ranked by mean MAE across the presidential cycles they were graded in. ⚠ An
 *  UNWEIGHTED mean of per-cycle grades, and the cycle count travels with it, because one
 *  graded cycle is not a track record. */
export const presidentialAgencyStandings = (
  cycles: readonly PresidentialCycleAccuracy[],
): PresidentialAgencyStanding[] => {
  const byAgency = new Map<string, PresidentialAgencyError[]>();
  for (const c of cycles)
    for (const a of c.agencies)
      byAgency.set(a.agencyId, [...(byAgency.get(a.agencyId) ?? []), a]);
  return [...byAgency.entries()]
    .map(([agencyId, rows]) => ({
      agencyId,
      meanMae: rows.reduce((s, r) => s + r.mae, 0) / rows.length,
      cycles: rows.length,
      medianDaysBefore: median(rows.map((r) => r.daysBefore)),
    }))
    .sort(
      (a, b) =>
        a.meanMae - b.meanMae ||
        b.cycles - a.cycles ||
        a.agencyId.localeCompare(b.agencyId),
    );
};

/** One agency's graded cycles, newest first. */
export const presidentialAgencyCycles = (
  cycles: readonly PresidentialCycleAccuracy[],
  agencyId: string,
): { cycle: PresidentialCycleAccuracy; grade: PresidentialAgencyError }[] =>
  cycles
    .flatMap((c) =>
      c.agencies
        .filter((a) => a.agencyId === agencyId)
        .map((grade) => ({ cycle: c, grade })),
    )
    .sort((a, b) => b.cycle.round1Date.localeCompare(a.cycle.round1Date));
